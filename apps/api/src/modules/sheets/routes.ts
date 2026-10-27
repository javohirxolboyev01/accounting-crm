import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { me, requireAuth, requireLeader } from '../../common/auth';
import { audit } from '../../common/audit';
import { AppError, notFound, parse } from '../../common/errors';
import { periodFromMonth } from '../../common/time';
import { config } from '../../config';
import { dryTx, one, pool, q, tx } from '../../db';
import { googleAdapter, googleConfigured } from './google';
import { importTable } from './importer';
import { syncState } from './sync';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export async function xlsxToRows(buf: Buffer, sheetName?: string): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!ws) throw new AppError(400, 'SHEET_NOT_FOUND', `Varaq topilmadi: ${sheetName}`);
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const arr: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      arr[col - 1] = cell.text;
    });
    rows[n - 1] = arr;
  });
  return Array.from(rows, (r) => r ?? []);
}

export async function syncAllEnabled() {
  if (!googleConfigured()) return [];
  const states = await q<{ id: number; spreadsheet_id: string; sheet_title: string }>(
    pool,
    'SELECT id, spreadsheet_id, sheet_title FROM sheet_sync_state WHERE enabled',
  );
  const out = [];
  for (const s of states) {
    try {
      out.push(await syncState(s.id, await googleAdapter(s.spreadsheet_id, s.sheet_title)));
    } catch (e) {
      console.error(`Sheets sinxron xatosi (${s.sheet_title}):`, (e as Error).message);
    }
  }
  return out;
}

export const sheetsRouter = Router();
sheetsRouter.use(requireAuth, requireLeader);

interface PreviousImport {
  fileName: string;
  importedAt: string;
  importedBy: string | null;
}

/**
 * Import: xlsx fayl (multipart "file") yoki Google Sheet (JSON: spreadsheetId, sheetTitle). dryRun=true standart.
 * Fayl mazmuni (SHA-256) avval import qilingan bo'lsa: dry-run javobida `alreadyImported`, haqiqiy importda 409
 * FILE_ALREADY_IMPORTED — bir xil faylni qayta yozish hech narsa qo'shmaydi, faqat chalg'itadi.
 */
sheetsRouter.post('/import', upload.single('file'), async (req, res) => {
  const u = me(req);
  const f = parse(
    z.object({
      dryRun: z.enum(['true', 'false']).default('true'),
      month: z.string().optional(),
      sheet: z.string().optional(),
    }),
    req.query,
  );
  const dryRun = f.dryRun === 'true';
  let rows: unknown[][];
  let fileHash: string | null = null;
  let previous: PreviousImport | undefined;
  if (req.file) {
    if (!/\.xlsx$/i.test(req.file.originalname)) throw new AppError(400, 'BAD_FILE', 'Faqat .xlsx fayl');
    fileHash = createHash('sha256').update(req.file.buffer).digest('hex');
    previous = await one<PreviousImport>(
      pool,
      `SELECT f.file_name AS "fileName", f.imported_at AS "importedAt", u.full_name AS "importedBy"
       FROM sheet_import_file f LEFT JOIN app_user u ON u.id = f.imported_by WHERE f.file_hash = $1`,
      [fileHash],
    );
    if (previous && !dryRun) throw new AppError(409, 'FILE_ALREADY_IMPORTED', 'Bu fayl allaqachon import qilingan', previous);
    rows = await xlsxToRows(req.file.buffer, f.sheet);
  } else {
    const body = parse(z.object({ spreadsheetId: z.string().min(10), sheetTitle: z.string().min(1) }), req.body);
    if (!googleConfigured()) throw new AppError(400, 'GOOGLE_NOT_CONFIGURED', 'Google service account sozlanmagan');
    rows = (await (await googleAdapter(body.spreadsheetId, body.sheetTitle)).read()).values;
  }
  const opts = { period: f.month ? periodFromMonth(f.month) : undefined, actorId: u.id, dryRun };
  const report = dryRun
    ? await dryTx((db) => importTable(db, rows, opts))
    : await tx(async (db) => {
        const r = await importTable(db, rows, opts);
        if (fileHash) {
          await db.query(
            `INSERT INTO sheet_import_file (file_hash, file_name, period, imported_by, summary) VALUES ($1, $2, $3, $4, $5)`,
            // multer nomni latin1 deb o'qiydi: kirill/o'zbekcha nomlar buzilmasin
            [fileHash, Buffer.from(req.file!.originalname, 'latin1').toString('utf8'), `${r.period}-01`, u.id, r.summary],
          );
        }
        return r;
      });
  res.json({ ...report, alreadyImported: previous ?? null });
});

sheetsRouter.get('/status', async (_req, res) => {
  const states = await q(
    pool,
    `SELECT id, spreadsheet_id AS "spreadsheetId", sheet_title AS "sheetTitle", to_char(period, 'YYYY-MM') AS month,
            enabled, last_synced_at AS "lastSyncedAt", status, details
     FROM sheet_sync_state ORDER BY id DESC`,
  );
  const errors = await q(
    pool,
    `SELECT id, kind, state_id AS "stateId", occurred_at AS "occurredAt", ref, stir, message, raw_value AS "rawValue"
     FROM sheet_sync_error WHERE NOT resolved AND kind = 'SYNC' ORDER BY occurred_at DESC LIMIT 200`,
  );
  res.json({
    googleConfigured: googleConfigured(),
    defaultSpreadsheetId: config.google.sheetId || null,
    intervalMinutes: 5,
    states,
    errors,
  });
});

sheetsRouter.put('/config', async (req, res) => {
  const u = me(req);
  const body = parse(
    z.object({
      spreadsheetId: z.string().min(10),
      sheetTitle: z.string().min(1).max(200),
      month: z.string(),
      enabled: z.boolean().default(true),
    }),
    req.body,
  );
  const period = periodFromMonth(body.month);
  const row = await tx(async (db) => {
    const r = await one(
      db,
      `INSERT INTO sheet_sync_state (spreadsheet_id, sheet_title, period, enabled) VALUES ($1, $2, $3, $4)
       ON CONFLICT (spreadsheet_id, sheet_title) DO UPDATE SET period = EXCLUDED.period, enabled = EXCLUDED.enabled
       RETURNING id`,
      [body.spreadsheetId, body.sheetTitle, period, body.enabled],
    );
    await audit(db, { actorId: u.id, entity: 'sheet_sync_state', entityId: r.id, action: 'CONFIG', after: body });
    return r;
  });
  res.json(row);
});

sheetsRouter.post('/sync', async (req, res) => {
  const { stateId } = parse(z.object({ stateId: z.coerce.number().int().optional() }), req.body ?? {});
  if (!googleConfigured()) throw new AppError(400, 'GOOGLE_NOT_CONFIGURED', 'Google service account sozlanmagan');
  if (!stateId) return res.json(await syncAllEnabled());
  const s = await one(pool, 'SELECT id, spreadsheet_id, sheet_title FROM sheet_sync_state WHERE id = $1', [stateId]);
  if (!s) throw notFound('Sinxron sozlamasi');
  res.json(await syncState(s.id, await googleAdapter(s.spreadsheet_id, s.sheet_title)));
});

sheetsRouter.get('/review', async (_req, res) => {
  res.json(
    await q(
      pool,
      `SELECT e.id, e.occurred_at AS "occurredAt", e.ref, e.stir, e.message, c.id AS "clientId"
       FROM sheet_sync_error e LEFT JOIN client c ON c.stir = e.stir
       WHERE e.kind = 'IMPORT_REVIEW' AND NOT e.resolved ORDER BY e.occurred_at DESC, e.id LIMIT 500`,
    ),
  );
});

sheetsRouter.post('/errors/:id/resolve', async (req, res) => {
  const u = me(req);
  const id = parse(z.coerce.number().int(), req.params.id);
  const r = await pool.query(
    'UPDATE sheet_sync_error SET resolved = true, resolved_by = $2, resolved_at = now() WHERE id = $1 AND NOT resolved',
    [id, u.id],
  );
  if (!r.rowCount) throw notFound('Yozuv');
  res.json({ ok: true });
});
