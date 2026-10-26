import { type Page, expect, test } from '@playwright/test';

const PASSWORD = 'Parol123!';

async function login(page: Page, login: string) {
  await page.goto('/login');
  await page.getByLabel('Login').fill(login);
  await page.getByLabel('Parol', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Kirish' }).click();
  await expect(page.getByRole('navigation', { name: 'Asosiy menyu' })).toBeVisible();
}

async function createClient(page: Page, c: { stir: string; name: string; tax: 'AOS' | 'QQS' }) {
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Yangi mijoz' }).click();
  await page.getByLabel('STIR').fill(c.stir);
  await page.getByLabel('Korxona nomi').fill(c.name);
  await page.getByLabel('Soliq turi', { exact: true }).click();
  await page.getByRole('option', { name: c.tax, exact: true }).click();
  await page.getByLabel('Javobgar buxgalter').click();
  await page.getByRole('option', { name: /Aziza Karimova/ }).click();
  await page.getByRole('button', { name: 'Yaratish' }).click();
  await expect(page).toHaveURL(/\/clients\/\d+$/);
  await expect(page.getByRole('heading', { name: c.name })).toBeVisible();
}

test('login: rahbar dashboardga, buxgalter rahbar sahifalariga kira olmaydi', async ({ page }) => {
  await login(page, 'rahbar');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Buxgalterlar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chiqish' }).click();
  await login(page, 'aziza');
  await expect(page).toHaveURL(/\/my-day/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/my-day/);
  await expect(page.getByRole('link', { name: 'Sozlamalar' })).toHaveCount(0);
});

test('mijoz yaratish (AOS va QQS) va oylik jadvalda X qoidasi', async ({ page }) => {
  await login(page, 'rahbar');
  await createClient(page, { stir: '401000001', name: 'E2E AOS MChJ', tax: 'AOS' });
  await createClient(page, { stir: '401000002', name: 'E2E QQS MChJ', tax: 'QQS' });
  await page.goto('/monthly');
  await page.getByLabel('Qidiruv').fill('E2E');
  await expect(page.getByRole('link', { name: 'E2E AOS MChJ' })).toBeVisible();
  // AOS: QQS va Foyda "—"; QQS: AOS "—"
  await expect(page.getByRole('button', { name: 'E2E AOS MChJ — QQS: Topshirmaydi' })).toHaveText('—');
  await expect(page.getByRole('button', { name: "E2E AOS MChJ — Foyda solig'i: Topshirmaydi" })).toHaveText('—');
  await expect(page.getByRole('button', { name: 'E2E QQS MChJ — AOS: Topshirmaydi' })).toHaveText('—');
  await expect(page.getByRole('button', { name: /^E2E AOS MChJ — AOS:/ })).not.toHaveText('—');
  await expect(page.getByRole('button', { name: /^E2E QQS MChJ — QQS:/ })).not.toHaveText('—');
  // Katak bosish -> Bajarildi
  await page.getByRole('button', { name: /^E2E QQS MChJ — QQS:/ }).click();
  await expect(page.getByText(/«QQS» bajarildi/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^E2E QQS MChJ — QQS:/ })).toHaveText('✓');
});

test('Bajarildi + 5 soniyalik Bekor qilish', async ({ page }) => {
  await login(page, 'aziza');
  const todo = page.getByRole('region', { name: 'Bajarilishi kerak' });
  const firstTitle = (await todo.locator('button.block span.font-medium').first().textContent())!;
  const before = await todo.getByRole('button', { name: 'Bajarildi' }).count();
  await todo.getByRole('button', { name: 'Bajarildi' }).first().click();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'bajarildi' });
  await expect(toast).toBeVisible();
  await expect(todo.getByRole('button', { name: 'Bajarildi' })).toHaveCount(before - 1);
  await toast.getByRole('button', { name: 'Bekor qilish' }).click();
  await expect(page.getByText('Bekor qilindi')).toBeVisible();
  await expect(todo.getByRole('button', { name: 'Bajarildi' })).toHaveCount(before);
  await expect(todo.getByText(firstTitle).first()).toBeVisible();
});

test('shoshilinch vazifa: buxgalter ekranida bir necha soniyada qizil xabar', async ({ browser }) => {
  const accCtx = await browser.newContext();
  const acc = await accCtx.newPage();
  await login(acc, 'aziza');
  await acc.waitForTimeout(1000); // SSE ulanishi

  const leadCtx = await browser.newContext();
  const lead = await leadCtx.newPage();
  await login(lead, 'rahbar');
  const started = Date.now();
  await lead.getByRole('button', { name: '+ Shoshilinch' }).click();
  const dialog = lead.getByRole('dialog');
  await dialog.getByPlaceholder(/Mijoz nomi yoki STIR/).fill('SHERPROM');
  await expect(dialog.getByRole('button', { name: /SHERPROM STROY/ })).toBeVisible();
  await dialog.getByPlaceholder(/Mijoz nomi yoki STIR/).press('Enter');
  await dialog.getByLabel('Vazifa matni').fill('E2E: bank ko\'chirmasini bugun kiritish');
  await dialog.getByRole('radio', { name: /Aziza Karimova/ }).check();
  await dialog.getByRole('button', { name: 'Yuborish' }).click();
  await expect(lead.getByText('Shoshilinch vazifa yuborildi')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(10_000);

  await expect(acc.locator('[data-sonner-toast]').filter({ hasText: "Shoshilinch vazifa: «E2E: bank ko'chirmasini" })).toBeVisible({ timeout: 8000 });
  await accCtx.close();
  await leadCtx.close();
});
