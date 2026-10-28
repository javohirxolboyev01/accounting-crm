import { Router } from 'express';
import { z } from 'zod';
import { isLeader, me, requireAuth } from '../common/auth';
import { parse } from '../common/errors';
import { normalizeName } from '../common/normalize';
import { periodFromMonth } from '../common/time';
import { type Db, pool, q, tx } from '../db';
import { getDueTime } from './generator';
import { markDone } from './taskService';

export type CellState = '1' | '0' | '!' | 'X';

export async function loadGrid(
  db: Db,
  period: string,
  f: { accountantId?: number; taxType?: string; status?: string; search?: string; clientIds?: number[] },
) {
  const dueTime = await getDueTime(db);
  const columns = await q(
    db,
    `SELECT id AS "reportTypeId", code, name, name_ru AS "nameRu", due_day AS "dueDay",
            creates_accountant_task AS "createsAccountantTask",
            to_char(fn_due_at($1, due_day, $2) AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS "dueDate"
     FROM fn_report_columns($1)`,
    [period, dueTime],
  );
  const where: string[] = [];
  const params: unknown[] = [period];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);
  if (f.accountantId) where.push(`c.accountant_id = ${p(f.accountantId)}`);
  if (f.status) where.push(`c.status = ${p(f.status)}`);
  if (f.search) where.push(`(c.name_normalized ILIKE ${p(`%${normalizeName(f.search)}%`)} OR c.stir LIKE ${p(`${f.search.replace(/\D/g, '') || '#'}%`)})`);
  if (f.clientIds) where.push(`c.id = ANY (${p(f.clientIds)}::bigint[])`);
  const cells = await q(
    db,
    `SELECT g.client_id AS "clientId", g.report_type_id AS "reportTypeId", g.tax_type AS "taxType",
            g.task_id AS "taskId", g.task_status AS "taskStatus", g.cell AS state,
            c.stir, c.name, c.status, c.note, c.accountant_id AS "accountantId", a.full_name AS "accountantName"
     FROM fn_monthly_grid($1) g
     JOIN client c ON c.id = g.client_id
     LEFT JOIN app_user a ON a.id = c.accountant_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY c.name_normalized, g.report_type_id`,
    params,
  );
  const rows = new Map<number, any>();
  for (const c of cells) {
    // Soliq turi filtri davrdagi tur bo'yicha (tarixdan)
    if (f.taxType && c.taxType !== f.taxType) continue;
    let r = rows.get(c.clientId);
    if (!r) {
      r = {
        clientId: c.clientId,
        stir: c.stir,
        name: c.name,
        taxType: c.taxType,
        status: c.status,
        note: c.note,
        accountantId: c.accountantId,
        accountantName: c.accountantName,
        cells: {} as Record<number, { state: CellState; taskId: number | null; taskStatus: string | null }>,
      };
      rows.set(c.clientId, r);
    }
    r.cells[c.reportTypeId] = { state: c.state, taskId: c.taskId, taskStatus: c.taskStatus };
  }
  return { period: period.slice(0, 7), columns, rows: [...rows.values()] };
}

export const gridRouter = Router();
gridRouter.use(requireAuth);

gridRouter.get('/', async (req, res) => {
  const u = me(req);
  const f = parse(
    z.object({
      month: z.string().optional(),
      accountantId: z.coerce.number().int().optional(),
      taxType: z.enum(['AOS', 'QQS']).optional(),
      status: z.enum(['ACTIVE', 'ZERO_REPORT', 'LIQUIDATING']).optional(),
      search: z.string().trim().optional(),
    }),
    req.query,
  );
  // Buxgalter faqat o'z mijozlarini ko'radi (serverda majburiy)
  const accountantId = isLeader(u) ? f.accountantId : u.id;
  res.json(await loadGrid(pool, periodFromMonth(f.month), { ...f, accountantId }));
});

// Katakchani bosish = "Bajarildi" (B4 mexanizmi, 5 soniyalik undo bilan).
// creates_accountant_task=false hisobot kataklarini ham mijozning buxgalteri/rahbar belgilay oladi (TODO(tasdiqlash)).
gridRouter.post('/cell/:taskId/done', async (req, res) => {
  const taskId = parse(z.coerce.number().int().positive(), req.params.taskId);
  res.json(await tx((db) => markDone(db, taskId, me(req), { source: 'GRID' })));
});
