import { Router } from 'express';
import { z } from 'zod';
import { type AuthUser, isLeader, me, requireAuth } from '../common/auth';
import { audit, diff } from '../common/audit';
import { AppError, forbidden, notFound, parse } from '../common/errors';
import { normalizeName, normalizeStir } from '../common/normalize';
import { currentPeriod } from '../common/time';
import { type Db, one, pool, q, tx } from '../db';
import { reassignOpenTasks, reconcileClient } from './generator';

const CLIENT = `c.id, c.stir, c.name, c.contact_person AS "contactPerson", c.phone, c.tax_type AS "taxType",
  c.tax_type_effective_from AS "taxTypeEffectiveFrom", c.accountant_id AS "accountantId",
  a.full_name AS "accountantName", c.status, c.note, c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;
const FROM = `FROM client c LEFT JOIN app_user a ON a.id = c.accountant_id`;

const stirSchema = z
  .string()
  .transform(normalizeStir)
  .refine((s) => /^(\d{9}|\d{14})$/.test(s), 'STIR 9 (yoki JShShIR 14) raqamdan iborat bo\'lishi kerak');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD');
const quarterSchema = z.string().regex(/^\d{4}-Q[1-4]$/, 'Chorak formati: 2026-Q3');

export const clientInput = z.object({
  stir: stirSchema,
  name: z.string().trim().min(1).max(300),
  contactPerson: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  // Faqat ikki qiymat (CLAUDE.md "Asosiy qoida")
  taxType: z.enum(['AOS', 'QQS']),
  taxTypeEffectiveFrom: isoDate.nullable().optional(),
  accountantId: z.number().int().positive().nullable().optional(),
  status: z.enum(['ACTIVE', 'ZERO_REPORT', 'LIQUIDATING']).default('ACTIVE'),
  note: z.string().max(5000).nullable().optional(),
});

async function assertAccountant(db: Db, id: number | null | undefined) {
  if (!id) return;
  const u = await one(db, `SELECT id FROM app_user WHERE id = $1 AND role = 'ACCOUNTANT' AND active`, [id]);
  if (!u) throw new AppError(400, 'INVALID_ACCOUNTANT', 'Buxgalter topilmadi yoki faol emas');
}

export async function loadClientForUser(db: Db, id: number, user: AuthUser, lock = false) {
  const c = await one(db, `SELECT ${CLIENT} ${FROM} WHERE c.id = $1 ${lock ? 'FOR UPDATE OF c' : ''}`, [id]);
  if (!c) throw notFound('Mijoz');
  if (!isLeader(user) && c.accountantId !== user.id) throw notFound('Mijoz'); // boshqaning mijozi "yo'q"
  return c;
}

/** Soliq turi tarixini yozish (bir sana uchun bitta yozuv) */
export async function recordTaxType(db: Db, clientId: number, taxType: string, effectiveFrom: string, actorId: number | null) {
  await db.query(
    `INSERT INTO client_tax_type_history (client_id, tax_type, effective_from, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, effective_from) DO UPDATE SET tax_type = EXCLUDED.tax_type, created_by = EXCLUDED.created_by`,
    [clientId, taxType, effectiveFrom, actorId],
  );
}

export async function createClient(db: Db, input: z.infer<typeof clientInput>, actorId: number | null) {
  await assertAccountant(db, input.accountantId);
  const c = await one(
    db,
    `INSERT INTO client (stir, name, name_normalized, contact_person, phone, tax_type, tax_type_effective_from,
                         accountant_id, status, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      input.stir,
      input.name,
      normalizeName(input.name),
      input.contactPerson ?? null,
      input.phone ?? null,
      input.taxType,
      input.taxTypeEffectiveFrom ?? null,
      input.accountantId ?? null,
      input.status,
      input.note ?? null,
    ],
  );
  // Boshlang'ich tur: "qachondan" berilmasa, butun o'tmish uchun amal qiladi
  await recordTaxType(db, c.id, input.taxType, input.taxTypeEffectiveFrom ?? '2000-01-01', actorId);
  await audit(db, { actorId, entity: 'client', entityId: c.id, clientId: c.id, action: 'CREATE', after: input });
  // Oy o'rtasida qo'shilgan mijozga joriy oy vazifalari darhol yaratiladi
  await reconcileClient(db, c.id, actorId);
  return c.id as number;
}

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

clientsRouter.get('/', async (req, res) => {
  const u = me(req);
  const f = parse(
    z.object({
      search: z.string().trim().optional(),
      status: z.enum(['ACTIVE', 'ZERO_REPORT', 'LIQUIDATING']).optional(),
      taxType: z.enum(['AOS', 'QQS']).optional(),
      accountantId: z.union([z.coerce.number().int(), z.literal('none')]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(500).default(25),
    }),
    req.query,
  );
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);
  if (!isLeader(u)) where.push(`c.accountant_id = ${p(u.id)}`); // serverda cheklov
  if (f.search) {
    const s = normalizeName(f.search);
    const digits = f.search.replace(/\D/g, '');
    where.push(`(c.name_normalized ILIKE ${p(`%${s}%`)} ${digits.length >= 3 ? `OR c.stir LIKE ${p(`${digits}%`)}` : ''})`);
  }
  if (f.status) where.push(`c.status = ${p(f.status)}`);
  if (f.taxType) where.push(`c.tax_type = ${p(f.taxType)}`);
  if (f.accountantId === 'none') where.push('c.accountant_id IS NULL');
  else if (f.accountantId) where.push(`c.accountant_id = ${p(f.accountantId)}`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one<{ n: number }>(pool, `SELECT count(*) AS n FROM client c ${w}`, params))!.n;
  const items = await q(
    pool,
    `SELECT ${CLIENT},
       (SELECT count(*) FROM task t WHERE t.client_id = c.id AND t.period = ${p(currentPeriod())}
          AND t.status IN ('TODO','IN_PROGRESS','WAITING_CLIENT'))::int AS "openTasks",
       (SELECT count(*) FROM task t WHERE t.client_id = c.id AND t.status IN ('TODO','IN_PROGRESS','WAITING_CLIENT')
          AND t.due_at < now())::int AS "overdueTasks"
     ${FROM} ${w} ORDER BY c.name_normalized LIMIT ${p(f.pageSize)} OFFSET ${p((f.page - 1) * f.pageSize)}`,
    params,
  );
  res.json({ items, total, page: f.page, pageSize: f.pageSize });
});

clientsRouter.get('/:id', async (req, res) => {
  const id = parse(z.coerce.number().int(), req.params.id);
  const c = await loadClientForUser(pool, id, me(req));
  const taxHistory = await q(
    pool,
    `SELECT h.id, h.tax_type AS "taxType", h.effective_from AS "effectiveFrom", h.created_at AS "createdAt",
            u.full_name AS "createdByName"
     FROM client_tax_type_history h LEFT JOIN app_user u ON u.id = h.created_by
     WHERE h.client_id = $1 ORDER BY h.effective_from DESC`,
    [id],
  );
  const dividendQuarters = (
    await q<{ quarter: string }>(pool, 'SELECT quarter FROM client_dividend_quarter WHERE client_id = $1 ORDER BY quarter DESC', [id])
  ).map((r) => r.quarter);
  res.json({ ...c, taxHistory, dividendQuarters });
});

clientsRouter.get('/:id/history', async (req, res) => {
  const id = parse(z.coerce.number().int(), req.params.id);
  await loadClientForUser(pool, id, me(req));
  res.json(
    await q(
      pool,
      `SELECT l.id, l.entity, l.entity_id AS "entityId", l.action, l.before, l.after, l.at,
              u.full_name AS "actorName"
       FROM audit_log l LEFT JOIN app_user u ON u.id = l.actor_id
       WHERE l.client_id = $1 ORDER BY l.at DESC, l.id DESC LIMIT 200`,
      [id],
    ),
  );
});

clientsRouter.post('/', async (req, res) => {
  const u = me(req);
  if (!isLeader(u)) throw forbidden();
  const input = parse(clientInput, req.body);
  const id = await tx((db) => createClient(db, input, u.id));
  res.status(201).json(await loadClientForUser(pool, id, u));
});

clientsRouter.patch('/:id', async (req, res) => {
  const u = me(req);
  const id = parse(z.coerce.number().int(), req.params.id);
  const body = parse(clientInput.partial().omit({ status: true }).extend({
    status: z.enum(['ACTIVE', 'ZERO_REPORT', 'LIQUIDATING']).optional(),
  }), req.body);
  // TODO(tasdiqlash): buxgalter faqat aloqa ma'lumotlari va izohni o'zgartira oladi
  const ACCOUNTANT_FIELDS = ['contactPerson', 'phone', 'note'];
  if (!isLeader(u) && Object.keys(body).some((k) => !ACCOUNTANT_FIELDS.includes(k))) throw forbidden();

  await tx(async (db) => {
    const before = await loadClientForUser(db, id, u, true);
    const d = diff(before, body);
    if (!d.changed) return;
    if (body.accountantId !== undefined) await assertAccountant(db, body.accountantId);

    const taxChanged = body.taxType !== undefined && body.taxType !== before.taxType;
    // Soliq turi o'zgarsa "qachondan" majburiy emas: berilmasa joriy oyning 1-kuni
    const effectiveFrom = body.taxTypeEffectiveFrom ?? (taxChanged ? currentPeriod() : undefined);

    await db.query(
      `UPDATE client SET
         stir = coalesce($2, stir), name = coalesce($3, name), name_normalized = coalesce($4, name_normalized),
         contact_person = CASE WHEN $5 THEN $6 ELSE contact_person END,
         phone = CASE WHEN $7 THEN $8 ELSE phone END,
         tax_type = coalesce($9, tax_type),
         tax_type_effective_from = CASE WHEN $10 THEN $11::date ELSE tax_type_effective_from END,
         accountant_id = CASE WHEN $12 THEN $13::bigint ELSE accountant_id END,
         status = coalesce($14, status),
         note = CASE WHEN $15 THEN $16 ELSE note END
       WHERE id = $1`,
      [
        id,
        body.stir ?? null,
        body.name ?? null,
        body.name ? normalizeName(body.name) : null,
        body.contactPerson !== undefined,
        body.contactPerson ?? null,
        body.phone !== undefined,
        body.phone ?? null,
        body.taxType ?? null,
        effectiveFrom !== undefined,
        effectiveFrom ?? null,
        body.accountantId !== undefined,
        body.accountantId ?? null,
        body.status ?? null,
        body.note !== undefined,
        body.note ?? null,
      ],
    );
    if (taxChanged || (body.taxTypeEffectiveFrom && body.taxType)) {
      await recordTaxType(db, id, body.taxType ?? before.taxType, effectiveFrom!, u.id);
    }
    await audit(db, { actorId: u.id, entity: 'client', entityId: id, clientId: id, action: 'UPDATE', before: d.before, after: d.after });

    // 6.8: buxgalter almashsa ochiq vazifalar yangisiga o'tadi
    if (body.accountantId !== undefined && body.accountantId !== before.accountantId) {
      await reassignOpenTasks(db, id, body.accountantId, u.id);
    }
    // Soliq turi yoki holat o'zgarsa joriy davr vazifalari moslashtiriladi
    if (taxChanged || body.taxTypeEffectiveFrom !== undefined || (body.status && body.status !== before.status)) {
      await reconcileClient(db, id, u.id);
    }
  });
  res.json(await loadClientForUser(pool, id, u));
});

// ---------- Dividend belgisi ----------
// TODO(tasdiqlash): belgini rahbar yoki mijozning buxgalteri qo'yadi deb olindi
clientsRouter.put('/:id/dividend/:quarter', async (req, res) => {
  const u = me(req);
  const id = parse(z.coerce.number().int(), req.params.id);
  const quarter = parse(quarterSchema, req.params.quarter);
  await tx(async (db) => {
    await loadClientForUser(db, id, u, true);
    const r = await db.query(
      `INSERT INTO client_dividend_quarter (client_id, quarter, marked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [id, quarter, u.id],
    );
    if (r.rowCount) {
      await audit(db, { actorId: u.id, entity: 'client', entityId: id, clientId: id, action: 'DIVIDEND_MARK', after: { quarter } });
      await reconcileClient(db, id, u.id);
    }
  });
  res.json({ ok: true });
});

clientsRouter.delete('/:id/dividend/:quarter', async (req, res) => {
  const u = me(req);
  const id = parse(z.coerce.number().int(), req.params.id);
  const quarter = parse(quarterSchema, req.params.quarter);
  await tx(async (db) => {
    await loadClientForUser(db, id, u, true);
    const r = await db.query('DELETE FROM client_dividend_quarter WHERE client_id = $1 AND quarter = $2', [id, quarter]);
    if (r.rowCount) {
      await audit(db, { actorId: u.id, entity: 'client', entityId: id, clientId: id, action: 'DIVIDEND_UNMARK', before: { quarter } });
      await reconcileClient(db, id, u.id);
    }
  });
  res.json({ ok: true });
});
