import { headerKey, transliterate } from '../../common/normalize';

// Sarlavha MATNI bo'yicha ustun aniqlash (indeks bo'yicha emas): sanalar har oy o'zgaradi,
// kirill/lotin aralash bo'lishi mumkin. Hisobot kalit so'zlari report_type.sheet_aliases'dan.

export interface ReportTypeLite {
  id: number;
  code: string;
  sheetAliases: string[];
}

export interface ReportColumn {
  col: number;
  reportTypeId: number;
  code: string;
  header: string;
  dueDate: string | null;
}

export interface ColumnMap {
  headerRow: number;
  stir: number;
  name: number | null;
  taxType: number | null;
  note: number | null;
  reports: ReportColumn[];
  /** Sarlavhadagi sanadan aniqlangan davr ('YYYY-MM-01') */
  period: string | null;
}

const has = (k: string, ...parts: string[]) => parts.some((p) => k.includes(p));

function classify(header: string, types: ReportTypeLite[]) {
  const k = headerKey(header);
  if (!k) return null;
  if (k === 'STIR' || k === 'INN' || k.startsWith('STIR') || k.startsWith('INN')) return { kind: 'STIR' as const };
  if (has(k, 'KORXONANOMI', 'NOMI', 'NAZVANIE', 'NAIMENOVANIE')) return { kind: 'NAME' as const };
  if (has(k, 'SOLIQTURI', 'VIDNALOG', 'TIPNALOG')) return { kind: 'TAX' as const };
  if (has(k, 'QILINISHI', 'LOZIM', 'IZOH', 'PRIMECHAN')) return { kind: 'NOTE' as const };
  // Eng uzun mos kalit so'z yutadi: "Poruchenya JSHDS" -> PORUCH, "JSHDS" emas
  let best: { t: ReportTypeLite; len: number } | null = null;
  for (const t of types) {
    for (const a of t.sheetAliases) {
      const ak = headerKey(a);
      if (ak && k.includes(ak) && (!best || ak.length > best.len)) best = { t, len: ak.length };
    }
  }
  return best ? { kind: 'REPORT' as const, type: best.t } : null;
}

function headerDate(header: string): string | null {
  const m = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(header);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join('');
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return String(o.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

export function detectColumns(rows: unknown[][], types: ReportTypeLite[]): ColumnMap | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] ?? [];
    const map: ColumnMap = { headerRow: r, stir: -1, name: null, taxType: null, note: null, reports: [], period: null };
    row.forEach((raw, col) => {
      const header = cellText(raw).trim();
      const c = classify(header, types);
      if (!c) return;
      if (c.kind === 'STIR' && map.stir < 0) map.stir = col;
      else if (c.kind === 'NAME' && map.name === null) map.name = col;
      else if (c.kind === 'TAX' && map.taxType === null) map.taxType = col;
      else if (c.kind === 'NOTE' && map.note === null) map.note = col;
      else if (c.kind === 'REPORT' && !map.reports.some((x) => x.reportTypeId === c.type.id)) {
        map.reports.push({ col, reportTypeId: c.type.id, code: c.type.code, header, dueDate: headerDate(header) });
      }
    });
    if (map.stir >= 0 && map.reports.length >= 1) {
      // TODO(tasdiqlash): davr = sarlavhadagi muddat sanasi oyi (15.10 -> oktyabr), CLAUDE.md 10.4
      const d = map.reports.find((x) => x.dueDate)?.dueDate;
      map.period = d ? `${d.slice(0, 7)}-01` : null;
      return map;
    }
  }
  return null;
}

export type SheetCell = '1' | '0' | 'X' | '';

/** 1/0/X (va ✓ ○ — kabi ko'rinishlar). null = tanib bo'lmaydigan qiymat */
export function parseCell(raw: unknown): SheetCell | null {
  const s = cellText(raw).trim();
  if (s === '') return '';
  if (['1', '✓', '✔', '+', '1.0'].includes(s)) return '1';
  if (['0', '○', '0.0'].includes(s)) return '0';
  if (['X', 'x', 'Х', 'х', '—', '–', '-', '×'].includes(s)) return 'X';
  return null;
}

export interface ParsedNote {
  status: 'LIQUIDATING' | 'ZERO_REPORT' | null;
  taxType: 'AOS' | 'QQS' | null;
  effectiveFrom: string | null;
  note: string | null;
  /** Avtomatik ajratib bo'lmadi: qo'lda tekshirish */
  review: string | null;
}

/**
 * Oxirgi ustun izohi -> status / tax_type_effective_from / note.
 * Aniq naqshga tushmagan, lekin sana yoki soliq turi tilga olingan izohlar jim taxmin qilinmaydi: review.
 */
export function parseNote(raw: unknown): ParsedNote {
  const text = cellText(raw).trim();
  const res: ParsedNote = { status: null, taxType: null, effectiveFrom: null, note: null, review: null };
  if (!text) return res;
  let rest = transliterate(text).toLowerCase().replace(/[‘’ʻʼ`´]/g, "'");
  const original = rest;

  if (/tugat|likvid|ликвид/.test(rest)) {
    res.status = 'LIQUIDATING';
    rest = rest.replace(/tugatishga\s*(berilgan|bergan|topshirilgan|topshirgan)?|tugatil\S*|likvidats\S*/g, ' ');
  } else if (/\bnol\b|\bnolga\b|nolev|nulev|nol hisobot/.test(rest)) {
    res.status = 'ZERO_REPORT';
    rest = rest.replace(/nol\s*(hisobot\S*)?|nulev\S*|nolev\S*/g, ' ');
  }

  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(?:y\.?|yil\S*)?\s*(?:dan|dən|s)?\s*(aos|aoc|qqs|kks|nds)\b/.exec(rest);
  if (m) {
    res.effectiveFrom = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    res.taxType = /^(aos|aoc)$/.test(m[4]) ? 'AOS' : 'QQS';
    rest = rest.replace(m[0], ' ').replace(/to'?lovchi\S*|tolovchi\S*|platel\S*|bo'?ldi|o'?tdi|ga\b/g, ' ');
  } else if (/\d{1,2}\.\d{1,2}\.\d{4}/.test(rest) || /\b(aos|aoc|qqs|kks)\b/.test(rest)) {
    res.review = 'Izohda sana yoki soliq turi bor, lekin "dd.mm.yyyy dan AOS/QQS to\'lovchisi" naqshiga mos emas';
  }

  // Naqshlardan keyin mazmunli matn qolsa, izoh to'liq saqlanadi
  const leftover = rest.replace(/[^a-z]/g, '');
  if (leftover.length > 2 || (!res.status && !res.effectiveFrom)) res.note = text;
  if (original && !res.status && !res.effectiveFrom && !res.review) res.note = text;
  return res;
}
