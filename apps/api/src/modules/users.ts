import { Router } from 'express';
import { z } from 'zod';
import { me, requireAuth, requireLeader } from '../common/auth';
import { audit, diff } from '../common/audit';
import { AppError, notFound, parse } from '../common/errors';
import { one, pool, q, tx } from '../db';
import { hashPassword, passwordSchema } from './auth';

const USER = `id, role, full_name AS "fullName", login, language, active,
  (telegram_chat_id IS NOT NULL) AS "telegramLinked", created_at AS "createdAt"`;

export const usersRouter = Router();

// Buxgalterlar ro'yxati (tanlash uchun) hamma xodimga ochiq, qolgani faqat rahbar
usersRouter.get('/accountants', requireAuth, async (_req, res) => {
  res.json(
    await q(
      pool,
      `SELECT u.id, u.full_name AS "fullName", l.open_count AS "openCount"
       FROM app_user u LEFT JOIN v_accountant_load l ON l.user_id = u.id
       WHERE u.role = 'ACCOUNTANT' AND u.active ORDER BY u.full_name`,
    ),
  );
});

usersRouter.use(requireAuth, requireLeader);

usersRouter.get('/', async (_req, res) => {
  res.json(await q(pool, `SELECT ${USER} FROM app_user ORDER BY active DESC, role, full_name`));
});

usersRouter.post('/', async (req, res) => {
  const actor = me(req);
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2).max(200),
      login: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/),
      password: passwordSchema,
      role: z.enum(['LEADER', 'ACCOUNTANT', 'OPERATOR']),
      language: z.enum(['uz', 'ru']).default('uz'),
    }),
    req.body,
  );
  const user = await tx(async (db) => {
    const u = await one(
      db,
      `INSERT INTO app_user (full_name, login, password_hash, role, language)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${USER}`,
      [body.fullName, body.login, await hashPassword(body.password), body.role, body.language],
    );
    await audit(db, { actorId: actor.id, entity: 'app_user', entityId: u.id, action: 'CREATE', after: u });
    return u;
  });
  res.status(201).json(user);
});

usersRouter.patch('/:id', async (req, res) => {
  const actor = me(req);
  const id = parse(z.coerce.number().int(), req.params.id);
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2).max(200).optional(),
      role: z.enum(['LEADER', 'ACCOUNTANT', 'OPERATOR']).optional(),
      language: z.enum(['uz', 'ru']).optional(),
      active: z.boolean().optional(),
    }),
    req.body,
  );
  if (id === actor.id && (body.active === false || (body.role && body.role !== 'LEADER'))) {
    throw new AppError(400, 'SELF_LOCKOUT', 'O\'zingizni faolsizlantira yoki rolingizni pasaytira olmaysiz');
  }
  const user = await tx(async (db) => {
    const before = await one(db, `SELECT ${USER} FROM app_user WHERE id = $1 FOR UPDATE`, [id]);
    if (!before) throw notFound('Foydalanuvchi');
    const u = await one(
      db,
      `UPDATE app_user SET full_name = coalesce($2, full_name), role = coalesce($3, role),
         language = coalesce($4, language), active = coalesce($5, active)
       WHERE id = $1 RETURNING ${USER}`,
      [id, body.fullName ?? null, body.role ?? null, body.language ?? null, body.active ?? null],
    );
    // Faolsizlantirilsa (o'chirilmaydi) sessiyalari yopiladi
    if (body.active === false) {
      await db.query('UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    }
    const d = diff(before, body);
    if (d.changed) await audit(db, { actorId: actor.id, entity: 'app_user', entityId: id, action: 'UPDATE', before: d.before, after: d.after });
    return u;
  });
  res.json(user);
});

usersRouter.post('/:id/reset-password', async (req, res) => {
  const actor = me(req);
  const id = parse(z.coerce.number().int(), req.params.id);
  const { password } = parse(z.object({ password: passwordSchema }), req.body);
  await tx(async (db) => {
    const r = await db.query(
      'UPDATE app_user SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [id, await hashPassword(password)],
    );
    if (!r.rowCount) throw notFound('Foydalanuvchi');
    await db.query('UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit(db, { actorId: actor.id, entity: 'app_user', entityId: id, action: 'RESET_PASSWORD' });
  });
  res.json({ ok: true });
});

/** Birinchi ishga tushishda rahbar (.env dan), agar bazada foydalanuvchi bo'lmasa */
export async function bootstrapLeader(login: string, password: string, fullName: string) {
  if (!login || !password) return false;
  const exists = await one<{ n: number }>(pool, 'SELECT count(*) AS n FROM app_user');
  if (exists!.n > 0) return false;
  await pool.query(
    `INSERT INTO app_user (full_name, login, password_hash, role) VALUES ($1, $2, $3, 'LEADER')`,
    [fullName, login, await hashPassword(password)],
  );
  console.log(`Boshlang'ich rahbar yaratildi: ${login}`);
  return true;
}
