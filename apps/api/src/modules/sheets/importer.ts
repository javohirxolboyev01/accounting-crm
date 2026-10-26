import { audit } from '../../common/audit';
import { AppError } from '../../common/errors';
import { normalizeName, normalizeStir, normalizeTaxType } from '../../common/normalize';
import { currentPeriod } from '../../common/time';
import { type Db, one, q } from '../../db';
import { createClient, recordTaxType } from '../clients';
import { reconcileClient } from '../generator';
import { markDone } from '../taskService';
import { type ReportTypeLite, cellText, detectColumns, parseCell, parseNote } from './parse';

export interface ImportRowResult {
  row: number;
  stir: string;
  name: string;
  action: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'SKIPPED';
  changes: string[];
  review: string[];
}

export interface ImportReport {
  dryRun: boolean;
  period: string;
  columns: { header: string; code: string }[];
  summary: { total: number; created: number; updated: number; unchanged: number; skipped: number; review: number; cellsDone: number };
  rows: ImportRowResult[];
  csv: string;
}

export async function loadReportTypes(db: Db): Promise<ReportTypeLite[]> {
  return q(db, `SELECT id, code, sheet_aliases AS "sheetAliases" FROM report_type`);
}

const csvEsc = (v: unknown) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Bir martalik import (B9 1-qism). Dry-run'da chaqiruvchi tranzaksiyani ROLLBACK qiladi:
 * hisobot aynan haqiqiy yozishdagi natija bo'ladi.
 */
export async function importTable(
  db: Db,
  rows: unknown[][],
  opts: { period?: string; actorId: number | null; dryRun: boolean },
): Promise<ImportReport> {
  const types = await loadReportTypes(db);
  const map = detectColumns(rows, types);
  if (!map) throw new AppError(400, 'HEADER_NOT_FOUND', 'Jadval sarlavhasi topilmadi (STIR va hisobot ustunlari kerak)');
  const period = opts.period ?? map.period ?? currentPeriod();
  const results: ImportRowResult[] = [];
  let cellsDone = 0;

  for (let r = map.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rawStir = cellText(row[map.stir]).trim();
    const name = map.name !== null ? cellText(row[map.name]).trim() : '';
    if (!rawStir && !name) continue; // bo'sh qator
    const stir = normalizeStir(rawStir);
    const res: ImportRowResult = { row: r + 1, stir, name, action: 'SKIPPED', changes: [], review: [] };
    results.push(res);

    if (!/^(\d{9}|\d{14})$/.test(stir)) {
      res.review.push(`STIR noto'g'ri: "${rawStir}"`);
      continue;
    }
    const taxRaw = map.taxType !== null ? cellText(row[map.taxType]) : '';
    const taxType = normalizeTaxType(taxRaw);
    if (!taxType) {
      res.review.push(`Soliq turi aniqlanmadi: "${taxRaw}"`);
      continue;
    }
    const note = parseNote(map.note !== null ? row[map.note] : '');
    if (note.review) res.review.push(note.review);
    if (note.taxType && note.taxType !== taxType) {
      res.review.push(`Izohdagi soliq turi (${note.taxType}) "Soliq turi" ustunidagi (${taxType}) bilan mos emas`);
    }

    const existing = await one<any>(
      db,
      `SELECT id, name, tax_type AS "taxType", tax_type_effective_from AS "taxTypeEffectiveFrom", status, note
       FROM client WHERE stir = $1 FOR UPDATE`,
      [stir],
    );
    let clientId: number;
    if (!existing) {
      clientId = await createClient(
        db,
        {
          stir,
          name: name || stir,
          taxType,
          taxTypeEffectiveFrom: note.taxType === taxType ? note.effectiveFrom : null,
          status: note.status ?? 'ACTIVE',
          note: note.note,
          accountantId: null,
          contactPerson: null,
          phone: null,
        },
        opts.actorId,
      );
      res.action = 'NEW';
    } else {
      clientId = existing.id;
      const upd: Record<string, unknown> = {};
      if (name && name !== existing.name) upd.name = name;
      if (taxType !== existing.taxType) upd.taxType = taxType;
      if (note.status && note.status !== existing.status) upd.status = note.status;
      if (note.note && note.note !== existing.note) upd.note = note.note;
      const eff = note.taxType === taxType ? note.effectiveFrom : null;
      if (eff && eff !== existing.taxTypeEffectiveFrom) upd.taxTypeEffectiveFrom = eff;
      if (Object.keys(upd).length) {
        await db.query(
          `UPDATE client SET name = coalesce($2, name), name_normalized = coalesce($3, name_normalized),
             tax_type = coalesce($4, tax_type), status = coalesce($5, status), note = coalesce($6, note),
             tax_type_effective_from = coalesce($7, tax_type_effective_from)
           WHERE id = $1`,
          [
            clientId,
            upd.name ?? null,
            upd.name ? normalizeName(String(upd.name)) : null,
            upd.taxType ?? null,
            upd.status ?? null,
            upd.note ?? null,
            upd.taxTypeEffectiveFrom ?? null,
          ],
        );
        if (upd.taxType || upd.taxTypeEffectiveFrom) {
          await recordTaxType(db, clientId, taxType, (upd.taxTypeEffectiveFrom as string) ?? period, opts.actorId);
        }
        await audit(db, {
          actorId: opts.actorId,
          entity: 'client',
          entityId: clientId,
          clientId,
          action: 'IMPORT_UPDATE',
          before: Object.fromEntries(Object.keys(upd).map((k) => [k, existing[k]])),
          after: upd,
        });
        res.action = 'UPDATED';
        res.changes = Object.keys(upd);
      } else {
        res.action = 'UNCHANGED';
      }
    }
    // Import davri uchun vazifalar (joriy oydan farq qilishi mumkin)
    await reconcileClient(db, clientId, opts.actorId, period);

    // Katak qiymatlari: 1 = DONE, 0 = ochiq, X = qo'llanmaydi. Soliq turiga zid qiymatlar -> review
    const cells = await q<any>(
      db,
      `SELECT report_type_id AS "reportTypeId", applicable, task_id AS "taskId", task_status AS "taskStatus"
       FROM fn_monthly_grid($1) WHERE client_id = $2`,
      [period, clientId],
    );
    for (const col of map.reports) {
      const v = parseCell(row[col.col]);
      const raw = cellText(row[col.col]).trim();
      if (v === null) {
        res.review.push(`${col.code}: tanib bo'lmaydigan qiymat "${raw}"`);
        continue;
      }
      if (v === '') continue;
      const cell = cells.find((c) => c.reportTypeId === col.reportTypeId);
      if (!cell) {
        if (v === '1') res.review.push(`${col.code}: bu oyda hisobot davri emas, lekin "1" qo'yilgan`);
        continue;
      }
      if (v === 'X' && cell.applicable) {
        res.review.push(`${col.code}: jadvalda X, lekin ${taxType} bo'yicha topshirilishi kerak`);
      } else if (v !== 'X' && !cell.applicable) {
        res.review.push(`${col.code}: jadvalda "${v}", lekin ${taxType} bo'yicha topshirilmaydi (X bo'lishi kerak)`);
      } else if (v === '1' && cell.taskId && cell.taskStatus !== 'DONE') {
        // Import paytida rahbarlarga ommaviy xabar yuborilmaydi
        await markDone(db, cell.taskId, null, { notify: false, source: 'IMPORT' });
        cellsDone++;
      } else if (v === '0' && cell.taskStatus === 'DONE') {
        res.review.push(`${col.code}: jadvalda 0, tizimda allaqachon bajarilgan`);
      }
    }
  }

  // Qo'lda tekshirish ro'yxati (dry-run'da ROLLBACK bilan yo'qoladi)
  for (const r of results) {
    for (const msg of r.review) {
      await db.query(
        `INSERT INTO sheet_sync_error (kind, ref, stir, message) VALUES ('IMPORT_REVIEW', $1, $2, $3)`,
        [`qator ${r.row}`, r.stir || null, `${r.name}: ${msg}`],
      );
    }
  }
  if (!opts.dryRun) {
    await audit(db, {
      actorId: opts.actorId,
      entity: 'sheet_import',
      entityId: period,
      action: 'IMPORT',
      after: { rows: results.length, created: results.filter((r) => r.action === 'NEW').length },
    });
  }

  const header = ['row', 'stir', 'name', 'action', 'changes', 'review'];
  const csv = [header, ...results.map((r) => [r.row, r.stir, r.name, r.action, r.changes.join('|'), r.review.join(' | ')])]
    .map((line) => line.map(csvEsc).join(','))
    .join('\n');

  return {
    dryRun: opts.dryRun,
    period: period.slice(0, 7),
    columns: map.reports.map((c) => ({ header: c.header, code: c.code })),
    summary: {
      total: results.length,
      created: results.filter((r) => r.action === 'NEW').length,
      updated: results.filter((r) => r.action === 'UPDATED').length,
      unchanged: results.filter((r) => r.action === 'UNCHANGED').length,
      skipped: results.filter((r) => r.action === 'SKIPPED').length,
      review: results.filter((r) => r.review.length > 0).length,
      cellsDone,
    },
    rows: results,
    csv: '﻿' + csv,
  };
}
