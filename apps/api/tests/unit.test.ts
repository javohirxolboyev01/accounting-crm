import { describe, expect, it } from 'vitest';
import { normalizeName, normalizeStir, normalizeTaxType } from '../src/common/normalize';
import { detectColumns, parseCell, parseNote } from '../src/modules/sheets/parse';

describe('normalizatsiya', () => {
  it('kirill/lotin va MChJ/МЧЖ bir xil shaklga keladi', () => {
    expect(normalizeName('"Navro\'z Agro" МЧЖ')).toBe(normalizeName('NAVROZ AGRO MChJ'));
    expect(normalizeName('ООО Ромашка')).toBe('mchj romashka');
    expect(normalizeName('SHERPROM  STROY MCHJ')).toBe('sherprom stroy mchj');
  });

  it('soliq turi: AOC/AOS/АОС/ҚҚС/QQS', () => {
    expect(normalizeTaxType('AOC')).toBe('AOS');
    expect(normalizeTaxType('АОС')).toBe('AOS');
    expect(normalizeTaxType('aos')).toBe('AOS');
    expect(normalizeTaxType('ҚҚС')).toBe('QQS');
    expect(normalizeTaxType('QQS')).toBe('QQS');
    expect(normalizeTaxType('boshqa')).toBeNull();
  });

  it('STIR faqat raqam', () => {
    expect(normalizeStir(' 305 123 456 ')).toBe('305123456');
  });
});

describe('izohni ajratish', () => {
  it('"Tugatishga bergan" -> LIQUIDATING, izoh bo\'sh', () => {
    expect(parseNote('Tugatishga bergan')).toMatchObject({ status: 'LIQUIDATING', note: null, review: null });
  });
  it('"01.01.2026 dan AOS to\'lovchisi" -> effective_from', () => {
    expect(parseNote("01.01.2026 dan AOS to'lovchisi")).toMatchObject({
      taxType: 'AOS',
      effectiveFrom: '2026-01-01',
      note: null,
      review: null,
    });
  });
  it('kirillcha izoh ham tushuniladi', () => {
    expect(parseNote('01.07.2026 дан ҚҚС тўловчиси')).toMatchObject({ taxType: 'QQS', effectiveFrom: '2026-07-01' });
  });
  it('oddiy matn -> note', () => {
    expect(parseNote('Direktor bilan gaplashish kerak')).toMatchObject({ note: 'Direktor bilan gaplashish kerak', review: null });
  });
  it('noaniq sana -> qo\'lda tekshirish', () => {
    const r = parseNote('15.03.2026 da tekshiruv');
    expect(r.review).not.toBeNull();
    expect(r.effectiveFrom).toBeNull();
  });
});

describe('sarlavha bo\'yicha ustun aniqlash', () => {
  const types = [
    { id: 1, code: 'JSHDS', sheetAliases: ['JSHDS'] },
    { id: 2, code: 'TOLOV_MANBAI', sheetAliases: ['TOLOVMANBA'] },
    { id: 3, code: 'AOS', sheetAliases: ['AOS', 'AOC'] },
    { id: 4, code: 'QQS', sheetAliases: ['QQS', 'KKS'] },
    { id: 5, code: 'INPS', sheetAliases: ['INPS'] },
    { id: 6, code: 'PORUCHENYA_JSHDS', sheetAliases: ['PORUCH'] },
    { id: 7, code: 'FOYDA', sheetAliases: ['FOYDA'] },
  ];
  it('haqiqiy jadval sarlavhasi (ustunlar tartibi aralash)', () => {
    const rows = [
      ['Hisobotlar 2026'],
      ['№', 'СТИР', 'Korxona nomi', 'Солиқ тури', 'QQS 20.10.2026', 'JSHDS 15.10.2026', "To'lov manbai 15.10.2026",
        'AOC 15.10.2026', 'FOYDA 20.10.2026', 'INPS', 'Poruchenya JSHDS', 'Қилиниши лозим бўлган ишлар'],
      ['1', '305123456', 'SHERPROM STROY', 'AOS', 'X', '1', '0', '1', 'X', '0', '', ''],
    ];
    const m = detectColumns(rows, types)!;
    expect(m.headerRow).toBe(1);
    expect(m.stir).toBe(1);
    expect(m.name).toBe(2);
    expect(m.taxType).toBe(3);
    expect(m.note).toBe(11);
    expect(m.period).toBe('2026-10-01');
    const byCode = Object.fromEntries(m.reports.map((r) => [r.code, r.col]));
    expect(byCode).toEqual({ QQS: 4, JSHDS: 5, TOLOV_MANBAI: 6, AOS: 7, FOYDA: 8, INPS: 9, PORUCHENYA_JSHDS: 10 });
  });

  it('katak qiymatlari', () => {
    expect(parseCell('1')).toBe('1');
    expect(parseCell(1)).toBe('1');
    expect(parseCell('✓')).toBe('1');
    expect(parseCell('0')).toBe('0');
    expect(parseCell('Х')).toBe('X'); // kirillcha Х
    expect(parseCell('—')).toBe('X');
    expect(parseCell('')).toBe('');
    expect(parseCell('ha')).toBeNull();
  });
});
