import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { dryTx, tx } from '../src/db';
import { importTable } from '../src/modules/sheets/importer';
import { type SheetAdapter, type SheetUpdate, syncState } from '../src/modules/sheets/sync';
import { app, one, pool, q, resetDb, seedTeam, token } from './helpers';

const HEADER = ['№', 'STIR', 'Korxona nomi', 'Soliq turi', 'JSHDS 15.10.2026', "To'lov manbai 15.10.2026", 'AOS 15.10.2026',
  'QQS 20.10.2026', 'FOYDA 20.10.2026', 'INPS', 'Poruchenya JSHDS', 'Қилиниши лозим бўлган ишлар'];

function sheet(): unknown[][] {
  return [
    HEADER,
    ['1', '305123456', 'SHERPROM STROY', 'AOC', '1', '0', '0', 'X', 'X', '0', '0', ''],
    ['2', '306234567', 'INSAR MIX TRADE', 'ҚҚС', '0', '0', 'X', '1', '0', '0', '0', ''],
    ['3', '307345678', 'ESKI QURILISH', 'AOS', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'Tugatishga bergan'],
    ['4', '308456789', 'YANGI TUR', 'AOS', '0', '0', '0', 'X', 'X', '0', '0', "01.01.2026 dan AOS to'lovchisi"],
    ['5', '309567890', 'NOANIQ', 'AOS', '0', '0', 'X', 'X', 'X', '0', 'ha', '15.03.2026 da tekshiruv'],
  ];
}

class MemorySheet implements SheetAdapter {
  writes: SheetUpdate[] = [];
  constructor(public values: unknown[][], public modifiedTime?: Date) {}
  async read() {
    return { values: this.values.map((r) => [...r]), modifiedTime: this.modifiedTime };
  }
  async write(u: SheetUpdate[]) {
    this.writes.push(...u);
    for (const x of u) this.values[x.row][x.col] = x.value;
  }
}

let leader: number;

describe('Sheets import', () => {
  beforeAll(async () => {
    await resetDb();
    leader = (await seedTeam()).leader;
  });

  it('dry-run bazaga yozmaydi, hisobot beradi', async () => {
    const r = await dryTx((db) => importTable(db, sheet(), { actorId: leader, dryRun: true }));
    expect(r.period).toBe('2026-10');
    expect(r.summary.created).toBe(5);
    expect(r.csv).toContain('stir');
    expect((await one(pool, 'SELECT count(*)::int AS n FROM client')).n).toBe(0);
    expect((await one(pool, 'SELECT count(*)::int AS n FROM sheet_sync_error')).n).toBe(0);
  });

  it('import: normalizatsiya, izoh bo\'linishi, 1 -> DONE, ziddiyatlar review ro\'yxatiga', async () => {
    const r = await tx((db) => importTable(db, sheet(), { actorId: leader, dryRun: false }));
    const c = await q(pool, `SELECT stir, tax_type, status, tax_type_effective_from AS eff, note FROM client ORDER BY stir`);
    expect(c[0]).toMatchObject({ stir: '305123456', tax_type: 'AOS', status: 'ACTIVE' });
    expect(c[1]).toMatchObject({ stir: '306234567', tax_type: 'QQS' });
    expect(c[2]).toMatchObject({ status: 'LIQUIDATING', note: null });
    expect(c[3]).toMatchObject({ eff: '2026-01-01', note: null });
    const jshds = await one(
      pool,
      `SELECT t.status FROM task t JOIN client c ON c.id = t.client_id JOIN report_type rt ON rt.id = t.report_type_id
       WHERE c.stir = '305123456' AND rt.code = 'JSHDS' AND t.period = '2026-10-01'`,
    );
    expect(jshds.status).toBe('DONE');
    const noaniq = r.rows.find((x) => x.stir === '309567890')!;
    expect(noaniq.review.some((m) => m.includes('PORUCHENYA'))).toBe(true); // "ha"
    expect(noaniq.review.some((m) => m.includes('AOS: jadvalda X'))).toBe(true); // AOS mijozda AOS X
    expect(noaniq.review.some((m) => m.includes('naqsh'))).toBe(true); // noaniq izoh
    // Import paytida rahbarlarga xabar yuborilmaydi
    expect((await one(pool, 'SELECT count(*)::int AS n FROM notification')).n).toBe(0);
    const review = await one(pool, `SELECT count(*)::int AS n FROM sheet_sync_error WHERE kind = 'IMPORT_REVIEW'`);
    expect(review.n).toBeGreaterThan(0);
  });

  it('qayta import: o\'zgarmaganlar UNCHANGED', async () => {
    const r = await dryTx((db) => importTable(db, sheet(), { actorId: leader, dryRun: true }));
    expect(r.summary.created).toBe(0);
    expect(r.rows.find((x) => x.stir === '305123456')!.action).toBe('UNCHANGED');
  });
});

describe('Sheets ikki tomonlama sinxron', () => {
  let stateId: number;
  let mem: MemorySheet;
  const COLS: Record<string, number> = { JSHDS: 4, TOLOV_MANBAI: 5, AOS: 6, QQS: 7, FOYDA: 8, INPS: 9, PORUCHENYA_JSHDS: 10 };
  const col = (code: string) => COLS[code];
  const taskStatus = async (stir: string, code: string) =>
    (
      await one(
        pool,
        `SELECT t.status FROM task t JOIN client c ON c.id = t.client_id JOIN report_type rt ON rt.id = t.report_type_id
         WHERE c.stir = $1 AND rt.code = $2 AND t.period = '2026-10-01' AND t.status <> 'CANCELLED'`,
        [stir, code],
      )
    ).status;

  beforeAll(async () => {
    stateId = (
      await one(pool, `INSERT INTO sheet_sync_state (spreadsheet_id, sheet_title, period) VALUES ('test-sheet-id', 'Oktyabr', '2026-10-01') RETURNING id`)
    ).id;
    mem = new MemorySheet(sheet().slice(0, 3));
  });

  it('birinchi sinxron: holatlar tenglashadi', async () => {
    const r = await syncState(stateId, mem);
    expect(r.errors).toBe(0);
    expect(mem.values[2][col('QQS')]).toBe('1');
  });

  it('jadvalda 1 -> tizimda DONE (rahbarga xabar navbatda)', async () => {
    mem.values[1][col('INPS')] = '1';
    const r = await syncState(stateId, mem);
    expect(r.appliedToSystem).toBe(1);
    expect(await taskStatus('305123456', 'INPS')).toBe('DONE');
    expect((await one(pool, `SELECT count(*)::int AS n FROM notification WHERE kind = 'TASK_DONE'`)).n).toBeGreaterThan(0);
  });

  it('tizimda Bajarildi -> jadvalda 1', async () => {
    await pool.query(
      `UPDATE task t SET status = 'DONE', done_at = now() FROM client c, report_type rt
       WHERE c.id = t.client_id AND rt.id = t.report_type_id AND c.stir = '306234567' AND rt.code = 'JSHDS' AND t.period = '2026-10-01'`,
    );
    const r = await syncState(stateId, mem);
    expect(r.writtenToSheet).toBe(1);
    expect(mem.values[2][col('JSHDS')]).toBe('1');
  });

  it('ziddiyat: oxirgi o\'zgargan yutadi, ikkala qiymat audit\'da', async () => {
    // Faqat tizim o'zgargan (TOLOV_MANBAI DONE) -> jadvalga yoziladi
    await pool.query(
      `UPDATE task t SET status = 'DONE', done_at = now() FROM client c, report_type rt
       WHERE c.id = t.client_id AND rt.id = t.report_type_id AND c.stir = '305123456' AND rt.code = 'TOLOV_MANBAI' AND t.period = '2026-10-01'`,
    );
    // Faqat jadval o'zgargan (INPS 1 -> 0) -> tizimda qayta ochiladi
    mem.values[1][col('INPS')] = '0';
    mem.modifiedTime = new Date(Date.now() - 3600_000); // jadval eskiroq
    const r = await syncState(stateId, mem);
    expect(r.writtenToSheet).toBeGreaterThanOrEqual(1);
    expect(mem.values[1][col('TOLOV_MANBAI')]).toBe('1');
    // INPS: faqat jadval o'zgardi (tizim L=1 da) -> tizimda qayta ochiladi
    expect(await taskStatus('305123456', 'INPS')).toBe('TODO');

    // Ikkala tomon o'zgargan va farq qiladi (0/1 da faqat oxirgi qiymat noma'lum bo'lganda yuz beradi):
    // L ni sun'iy 'X' qilamiz, jadval 1 (1 soat oldin), tizim 0 (hozir yangilangan)
    await pool.query(`UPDATE sheet_sync_cell SET value = 'X' WHERE state_id = $1 AND stir = '305123456' AND report_code = 'INPS'`, [stateId]);
    mem.values[1][col('INPS')] = '1';
    const r2 = await syncState(stateId, mem);
    expect(r2.conflicts).toBe(1);
    // Tizim yangiroq (updated_at hozir, jadval 1 soat oldin) -> tizim qiymati (0) yutadi
    expect(mem.values[1][col('INPS')]).toBe('0');
    const a = await one(pool, `SELECT before, after FROM audit_log WHERE action = 'SYNC_CONFLICT' ORDER BY id DESC LIMIT 1`);
    expect(a.before).toMatchObject({ sheet: '1', system: '0' });
    expect(a.after).toMatchObject({ winner: 'SYSTEM' });
  });

  it('tanib bo\'lmaydigan qiymat -> sheet_sync_error, katakka tegilmaydi', async () => {
    mem.values[1][col('JSHDS')] = 'ha';
    const before = mem.writes.length;
    const r = await syncState(stateId, mem);
    expect(r.errors).toBeGreaterThan(0);
    expect(mem.values[1][col('JSHDS')]).toBe('ha');
    expect(mem.writes.slice(before).some((w) => w.col === col('JSHDS'))).toBe(false);
    const e = await one(pool, `SELECT message, raw_value FROM sheet_sync_error WHERE kind = 'SYNC' AND raw_value = 'ha'`);
    expect(e).toBeTruthy();
  });
});

describe('Sheets import: bir xil faylni qayta yuklash', () => {
  let tok: string;
  let xlsx: Buffer;
  beforeAll(async () => {
    await resetDb();
    await seedTeam();
    tok = await token('leader');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Oktyabr').addRows(sheet());
    xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  });
  const upload = (dryRun: boolean, name = 'hisobot.xlsx') =>
    request(app).post(`/api/sheets/import?dryRun=${dryRun}`).set('Authorization', `Bearer ${tok}`).attach('file', xlsx, name);

  it('birinchi import yoziladi; qayta yuklash (boshqa nom bilan ham) 409, dry-run ogohlantiradi', async () => {
    const first = await upload(false);
    expect(first.status).toBe(200);
    expect(first.body.summary.created).toBe(5);
    expect(first.body.alreadyImported).toBeNull();

    const again = await upload(false, 'nusxa.xlsx');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('FILE_ALREADY_IMPORTED');
    expect(again.body.details).toMatchObject({ fileName: 'hisobot.xlsx', importedBy: 'Rahbar' });

    const dry = await upload(true);
    expect(dry.status).toBe(200);
    expect(dry.body.alreadyImported).toMatchObject({ fileName: 'hisobot.xlsx' });
    expect((await one(pool, 'SELECT count(*)::int AS n FROM sheet_import_file')).n).toBe(1);
  });
});
