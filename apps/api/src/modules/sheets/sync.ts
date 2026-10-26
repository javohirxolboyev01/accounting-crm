import { audit } from '../../common/audit';
import { normalizeStir } from '../../common/normalize';
import { one, pool, q, tx } from '../../db';
import { loadGrid } from '../grid';
import { markDone, reopenBySystem } from '../taskService';
import { loadReportTypes } from './importer';
import { cellText, detectColumns, parseCell } from './parse';

export interface SheetUpdate {
  row: number; // 0-index
  col: number; // 0-index
  value: string;
}

/** Jadval manbai (Google Sheets yoki testda xotiradagi jadval) */
export interface SheetAdapter {
  read(): Promise<{ values: unknown[][]; modifiedTime?: Date }>;
  write(updates: SheetUpdate[]): Promise<void>;
}

export interface SyncResult {
  stateId: number;
  appliedToSystem: number;
  writtenToSheet: number;
  conflicts: number;
  errors: number;
}

async function logError(stateId: number, ref: string, stir: string | null, message: string, raw: string | null) {
  // Bir xil ochiq xato qayta-qayta yozilmasin
  await pool.query(
    `INSERT INTO sheet_sync_error (kind, state_id, ref, stir, message, raw_value)
     SELECT 'SYNC', $1, $2, $3, $4, $5
     WHERE NOT EXISTS (SELECT 1 FROM sheet_sync_error WHERE kind = 'SYNC' AND state_id = $1 AND ref = $2
                       AND message = $4 AND NOT resolved)`,
    [stateId, ref, stir, message, raw],
  );
}

/**
 * Ikki tomonlama sinxron. Har katak uchun oxirgi sinxronlangan qiymat (L) saqlanadi:
 *  - faqat jadval o'zgargan (S != L) -> tizimga qo'llanadi (1 -> DONE, bildirishnoma qoidalari bilan; 0 -> qayta ochiladi);
 *  - faqat tizim o'zgargan (T != L) -> jadvalga yoziladi;
 *  - ikkalasi o'zgargan -> updated_at bo'yicha oxirgisi yutadi (jadval uchun fayl modifiedTime), ikkala qiymat audit'ga.
 * X (qo'llanmaydi) faqat soliq turidan kelib chiqadi: jadvaldagi zid X/qiymat -> sheet_sync_error, katakka tegilmaydi.
 */
export async function syncState(stateId: number, adapter: SheetAdapter): Promise<SyncResult> {
  const state = await one<any>(pool, 'SELECT id, period FROM sheet_sync_state WHERE id = $1', [stateId]);
  if (!state) throw new Error(`sheet_sync_state ${stateId} topilmadi`);
  const result: SyncResult = { stateId, appliedToSystem: 0, writtenToSheet: 0, conflicts: 0, errors: 0 };
  const errors: Parameters<typeof logError>[] = [];
  try {
    const { values, modifiedTime } = await adapter.read();
    const sheetTime = modifiedTime ?? new Date();
    const map = detectColumns(values, await loadReportTypes(pool));
    if (!map) throw new Error('Jadval sarlavhasi topilmadi');

    await tx(async (db) => {
      const grid = await loadGrid(db, state.period, {});
      const byStir = new Map(grid.rows.map((r) => [r.stir, r]));
      const last = new Map(
        (await q<any>(db, 'SELECT stir, report_code, value FROM sheet_sync_cell WHERE state_id = $1', [stateId])).map((c) => [
          `${c.stir}|${c.report_code}`,
          c.value as string,
        ]),
      );
      const updates: SheetUpdate[] = [];
      const finals: { stir: string; code: string; value: string }[] = [];

      for (let r = map.headerRow + 1; r < values.length; r++) {
        const row = values[r] ?? [];
        const stir = normalizeStir(cellText(row[map.stir]));
        if (!stir) continue;
        const gr = byStir.get(stir);
        if (!gr) {
          errors.push([stateId, `qator ${r + 1}`, stir, 'Mijoz tizimda topilmadi', null]);
          continue;
        }
        for (const col of map.reports) {
          const cell = gr.cells[col.reportTypeId];
          if (!cell) continue; // bu oy uchun ustun emas
          const ref = `qator ${r + 1}, ${col.code}`;
          const raw = cellText(row[col.col]).trim();
          const parsed = parseCell(raw);
          if (parsed === null) {
            errors.push([stateId, ref, stir, 'Tanib bo\'lmaydigan qiymat', raw]);
            continue;
          }
          const S = parsed === '' ? '0' : parsed;
          const T = cell.state === '!' ? '0' : cell.state; // jadvalda "!" yo'q
          const key = `${stir}|${col.code}`;
          const L = last.get(key);

          let F: string;
          if (S === T) F = S;
          else if (S === 'X' || T === 'X') {
            errors.push([stateId, ref, stir, T === 'X' ? 'Jadvalda qiymat bor, lekin soliq turi bo\'yicha X' : 'Jadvalda X, lekin topshirilishi kerak', raw]);
            continue;
          } else if (L === undefined) {
            F = '1'; // birinchi sinxron: bir tomonda "1" bo'lsa, topshirilgan deb olinadi
          } else {
            const sheetChanged = S !== L;
            const sysChanged = T !== L;
            if (sheetChanged && !sysChanged) F = S;
            else if (!sheetChanged && sysChanged) F = T;
            else {
              const sysTime = cell.taskId
                ? (await one<{ updated_at: Date }>(db, 'SELECT updated_at FROM task WHERE id = $1', [cell.taskId]))!.updated_at
                : new Date(0);
              F = sheetTime > sysTime ? S : T;
              result.conflicts++;
              await audit(db, {
                actorId: null,
                entity: 'sheet_sync',
                entityId: cell.taskId,
                clientId: gr.clientId,
                action: 'SYNC_CONFLICT',
                before: { sheet: S, system: T, lastSynced: L, sheetTime, systemTime: sysTime },
                after: { winner: F === S ? 'SHEET' : 'SYSTEM', value: F },
              });
            }
          }

          if (F !== T && cell.taskId) {
            if (F === '1') await markDone(db, cell.taskId, null, { source: 'SHEET' });
            else await reopenBySystem(db, cell.taskId, 'SHEET');
            result.appliedToSystem++;
          }
          if (F !== S) updates.push({ row: r, col: col.col, value: F });
          finals.push({ stir, code: col.code, value: F });
        }
      }

      for (const f of finals) {
        await db.query(
          `INSERT INTO sheet_sync_cell (state_id, stir, report_code, value) VALUES ($1, $2, $3, $4)
           ON CONFLICT (state_id, stir, report_code) DO UPDATE SET value = EXCLUDED.value, synced_at = now()`,
          [stateId, f.stir, f.code, f.value],
        );
      }
      // Jadvalga yozish tranzaksiya ichida: yozish muvaffaqiyatsiz bo'lsa tizim o'zgarishlari ham qaytadi
      if (updates.length) await adapter.write(updates);
      result.writtenToSheet = updates.length;
    });

    for (const e of errors) await logError(...e);
    result.errors = errors.length;
    await pool.query(
      `UPDATE sheet_sync_state SET last_synced_at = now(), status = $2, details = $3 WHERE id = $1`,
      [stateId, errors.length ? 'OK_WITH_ERRORS' : 'OK', JSON.stringify(result)],
    );
    return result;
  } catch (e) {
    await pool.query(`UPDATE sheet_sync_state SET status = 'ERROR', details = $2 WHERE id = $1`, [
      stateId,
      JSON.stringify({ error: (e as Error).message }),
    ]);
    throw e;
  }
}
