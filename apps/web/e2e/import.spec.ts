import ExcelJS from 'exceljs';
import { type Page, expect, test } from '@playwright/test';

const PASSWORD = 'Parol123!';
const SHOTS = process.env.E2E_SHOTS_DIR;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function login(page: Page, login: string) {
  await page.goto('/login');
  await page.getByLabel('Login').fill(login);
  await page.getByLabel('Parol', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await expect(page.getByRole('navigation', { name: 'Asosiy menyu' })).toBeVisible();
}

/** Hisobot topshirish jadvali (haqiqiy fayl sarlavhalari) */
async function reportsFile() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Oktyabr').addRows([
    ['№', 'STIR', 'Korxona nomi', 'Soliq turi', 'JSHDS 15.10.2026', "To'lov manbai 15.10.2026", 'AOS 15.10.2026',
      'QQS 20.10.2026', 'FOYDA 20.10.2026', 'INPS', 'Poruchenya JSHDS', 'Қилиниши лозим бўлган ишлар'],
    ['1', '601000001', 'E2E IMPORT MChJ', 'AOC', '1', '0', '0', 'X', 'X', '0', '0', ''],
    ['2', '601000002', 'E2E IZOH MChJ', 'QQS', '0', '0', 'X', '0', '0', '0', '0', '15.03.2026 da tekshiruv'],
  ]);
  return { name: 'hisobot oktyabr.xlsx', mimeType: XLSX, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

test('Excel import har sahifaning o\'zida; Google Sheets sahifasi yo\'q', async ({ page }) => {
  await login(page, 'rahbar');
  await expect(page.getByRole('link', { name: 'Google Sheets' })).toHaveCount(0);
  const file = await reportsFile();

  // Buxgalter ishlari sahifasi hisobot jadvalini qabul qilmaydi
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Excel yuklash' }).click();
  let dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('heading', { name: /«Бухгалтер ишлари» faylini yuklash/ })).toBeVisible();
  await dlg.locator('input[type=file]').setInputFiles(file);
  await dlg.getByRole('button', { name: /Tekshirish/ }).click();
  await expect(page.getByText("Bu hisobot topshirish jadvali. Uni «Hisobot topshirish» sahifasidan yuklang.")).toBeVisible();
  await page.keyboard.press('Escape');

  // Hisobot topshirish: tekshirish -> yuklash
  await page.goto('/monthly');
  await page.getByRole('button', { name: 'Excel yuklash' }).click();
  dlg = page.getByRole('dialog');
  await dlg.locator('input[type=file]').setInputFiles(file);
  await dlg.getByRole('button', { name: /Tekshirish/ }).click();
  await expect(dlg.getByText(/Ko'rib chiqish natijasi/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/6-monthly-import.png` });
  await dlg.getByRole('button', { name: "CRM'ga yuklash" }).first().click();
  await expect(dlg.getByText(/CRM'ga yozildi/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Izohdagi noaniq sana — "Qo'lda tekshirish" tugmasi sahifada paydo bo'ladi
  await page.getByRole('button', { name: /Qo'lda tekshirish \(\d+\)/ }).click();
  await expect(page.getByRole('dialog').getByText(/601000002/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-review.png` });
  await page.keyboard.press('Escape');

  await page.getByLabel('Qidiruv').fill('E2E IMPORT');
  await expect(page.getByRole('link', { name: 'E2E IMPORT MChJ' })).toBeVisible();

  // Eski manzil bosh sahifaga qaytadi
  await page.goto('/sheets');
  await expect(page).toHaveURL(/\/dashboard/);
});
