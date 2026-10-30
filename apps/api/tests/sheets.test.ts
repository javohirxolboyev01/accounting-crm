import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { dryTx, tx } from '../src/db';
import { importTable } from '../src/modules/sheets/importer';
import { detectWorksFile, importWorks } from '../src/modules/sheets/worksImporter';
import { generatePeriod } from '../src/modules/generator';
import { app, one, pool, q, reportCodes, resetDb, seedTeam, token } from './helpers';

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
    // AOS mijozda AOS X: review emas, doimiy "topshirmaydi" belgisi (V17), vazifa bekor, jadvalda X
    expect(noaniq.changes).toContain('AOS=X');
    const aosCell = await one(
      pool,
      `SELECT g.cell FROM fn_monthly_grid('2026-10-01') g JOIN client c ON c.id = g.client_id JOIN report_type rt ON rt.id = g.report_type_id
       WHERE c.stir = '309567890' AND rt.code = 'AOS'`,
    );
    expect(aosCell.cell).toBe('X');
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

  it('X belgisi keyingi oylarda ham saqlanadi; faylda 1 kelsa olib tashlanadi', async () => {
    const c = (await one(pool, `SELECT id FROM client WHERE stir = '309567890'`)).id;
    await tx((db) => generatePeriod(db, '2026-11-01'));
    expect(await reportCodes(c, '2026-11-01')).not.toContain('AOS');
    const rows = sheet();
    rows[5][6] = '1';
    await tx((db) => importTable(db, rows, { actorId: leader, dryRun: false }));
    expect((await one(pool, 'SELECT count(*)::int AS n FROM client_report_exclusion WHERE client_id = $1', [c])).n).toBe(0);
    expect(await reportCodes(c, '2026-10-01')).toContain('AOS');
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

  it('sahifaga mos kelmagan fayl rad etiladi: hisobot fayli Buxgalter ishlari sahifasiga yuklanmaydi', async () => {
    const r = await request(app).post('/api/sheets/import?dryRun=true&kind=WORKS').set('Authorization', `Bearer ${tok}`).attach('file', xlsx, 'hisobot.xlsx');
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'WRONG_FILE_KIND', details: { detected: 'REPORTS', expected: 'WORKS' } });
    const ok = await request(app).post('/api/sheets/import?dryRun=true&kind=REPORTS').set('Authorization', `Bearer ${tok}`).attach('file', xlsx, 'hisobot.xlsx');
    expect(ok.status).toBe(200);
    expect(ok.body.kind).toBe('REPORTS');
  });
});

// "Бухгалтер ишлари" fayli: ikki qatorli sarlavha, birlashtirilgan guruhlar
const WORKS_TOP = ['', 'СТИР', 'Номи', 'Солиқ тури', 'ойлик тулов', '30% (Бухгалтерлар улуши)', 'Жавобгар', 'Банк-ключ',
  'my.mehnat.uz', 'my.mehnat.uz', 'my.mehnat.uz', 'my.mehnat.uz', 'ИНПС ҳисобот', 'Иш  ҳақи', 'Банк виписка',
  'Счёт-фактура', 'Счёт-фактура', 'Дебетор-Кредитор', 'Ойлар ёпилиши', 'Бошқа ишлар', 'Изоҳ'];
const WORKS_SUB = [...WORKS_TOP];
WORKS_SUB.splice(8, 4, 'ходим сони', 'сана', 'логин', 'парол');
WORKS_SUB.splice(15, 2, 'кирим', 'Чиқим');

describe('"Бухгалтер ишлари" fayli importi', () => {
  let team: Awaited<ReturnType<typeof seedTeam>>;
  beforeAll(async () => {
    await resetDb();
    team = await seedTeam();
  });
  const works = () => [
    WORKS_TOP,
    WORKS_SUB,
    ['1', '2', '3', '4', '', '5', '', '6', '7', '8', '', '', '9', '10', '11', '12', '13', '19', '20', '', ''],
    ['11', '310309859', '"ALICOM" MCHJ', 'АОС', '1000000', '300000', 'Азиза', 'Бор', '3', '31.07.2025', 'jdev', 'Pa$$1',
      '2026-09-30', '2026-08-31', '', '2025-12-31', '2025-09-30', '', '', '', 'Эски даври бор'],
    ['', '', '"MIX" МЧЖ', '', '', '', 'Номаълум', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '63003046290049', 'OLIMOVA', 'YaTT', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];

  it('fayl turi aniqlanadi, mijoz maydonlari va "qaysi oygacha" yoziladi', async () => {
    const map = await detectWorksFile(pool, works());
    expect(map).not.toBeNull();
    expect(map!.headerRow).toBe(1);
    // Hisobot importi uni o'zi tanimaydi, yo'naltirish routes.ts'da
    const r = await tx((db) => importWorks(db, works(), map!, { actorId: team.leader, dryRun: false }));
    expect(r.kind).toBe('WORKS');
    expect(r.summary).toMatchObject({ total: 3, created: 1, skipped: 2 });
    const c = await one(
      pool,
      `SELECT id, accountant_id, monthly_fee::int AS fee, bank_key, employee_count, to_char(mehnat_checked_at, 'YYYY-MM-DD') AS checked,
              mehnat_login, mehnat_password_enc IS NOT NULL AS has_pw, note
       FROM client WHERE stir = '310309859'`,
    );
    expect(c).toMatchObject({ accountant_id: team.acc1, fee: 1000000, bank_key: true, employee_count: 3, checked: '2025-07-31', mehnat_login: 'jdev', has_pw: true, note: 'Эски даври бор' });
    const base = await q(
      pool,
      `SELECT w.name, to_char(b.done_through, 'YYYY-MM') AS m FROM client_routine_baseline b JOIN routine_work_type w ON w.id = b.routine_type_id
       WHERE b.client_id = $1`,
      [c.id],
    );
    const by = Object.fromEntries(base.map((b) => [b.name, b.m]));
    expect(by['Ish haqi hisoblash']).toBe('2026-08');
    expect(by['Kirim hisobvaraq-fakturalarini kiritish']).toBe('2025-12');
    expect(by['Bank aylanmalarini kiritish']).toBeUndefined(); // bo'sh katak
    expect(r.rows.find((x) => x.name.includes('MIX'))!.review).toContain("STIR yo'q");
    expect(r.rows.find((x) => x.stir === '63003046290049')!.review[0]).toContain('YaTT');
  });

  it('hisobot fayli Бухгалтер ишлари deb aniqlanmaydi', async () => {
    expect(await detectWorksFile(pool, sheet())).toBeNull();
  });
});

describe('Import: holat bo\'yicha hisobot ustunlari (Norezident foyda / QQS, V20)', () => {
  beforeAll(async () => {
    await resetDb();
    await seedTeam();
  });
  const H = ['№', 'STIR', 'Korxona nomi', 'Soliq turi', 'JSHDS 15.10.2026', 'Norezident foyda', 'Norezident QQS'];

  it('1 -> holat oyi (sentabr) belgisi qo\'yiladi va oktyabr vazifasi Bajarildi; X -> belgi yo\'q', async () => {
    const rows = [H, ['1', '306234567', 'INSAR MIX TRADE', 'ҚҚС', '1', '1', 'X']];
    const r = await tx((db) => importTable(db, rows, { actorId: null, dryRun: false }));
    expect(r.columns.map((c) => c.code)).toEqual(['JSHDS', 'NOREZIDENT_FOYDA', 'NOREZIDENT_QQS']);
    expect(r.rows[0].review).toEqual([]);
    const ev = await q(
      pool,
      `SELECT rt.code, ev.month FROM client_report_event ev JOIN report_type rt ON rt.id = ev.report_type_id`,
    );
    expect(ev).toEqual([{ code: 'NOREZIDENT_FOYDA', month: '2026-09' }]);
    const t = await one(
      pool,
      `SELECT t.status FROM task t JOIN report_type rt ON rt.id = t.report_type_id
       WHERE rt.code = 'NOREZIDENT_FOYDA' AND t.period = '2026-10-01'`,
    );
    expect(t.status).toBe('DONE');
    expect((await one(pool, 'SELECT count(*)::int AS n FROM client_report_exclusion')).n).toBe(0);
  });
});
