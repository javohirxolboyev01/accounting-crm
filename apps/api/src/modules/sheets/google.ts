import fs from 'node:fs';
import { config } from '../../config';
import type { SheetAdapter } from './sync';

export const googleConfigured = () =>
  Boolean(config.google.serviceAccountFile && fs.existsSync(config.google.serviceAccountFile));

function colLetter(col: number) {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const quoteTitle = (t: string) => `'${t.replace(/'/g, "''")}'`;

/** Google Sheets API (service account). Jadvalni service account email'iga "Muharrir" sifatida ulashish kerak. */
export async function googleAdapter(spreadsheetId: string, sheetTitle: string): Promise<SheetAdapter> {
  // googleapis og'ir paket: faqat kerak bo'lganda yuklanadi
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: config.google.serviceAccountFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.metadata.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });
  return {
    async read() {
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: quoteTitle(sheetTitle),
        valueRenderOption: 'FORMATTED_VALUE',
      });
      const meta = await drive.files
        .get({ fileId: spreadsheetId, fields: 'modifiedTime', supportsAllDrives: true })
        .catch(() => null);
      return {
        values: (r.data.values ?? []) as unknown[][],
        modifiedTime: meta?.data.modifiedTime ? new Date(meta.data.modifiedTime) : undefined,
      };
    },
    async write(updates) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates.map((u) => ({
            range: `${quoteTitle(sheetTitle)}!${colLetter(u.col)}${u.row + 1}`,
            values: [[u.value]],
          })),
        },
      });
    },
  };
}

export { colLetter };
