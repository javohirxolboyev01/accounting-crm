// Playwright uchun: alohida e2e bazasini noldan tayyorlab, dev seed bilan API ni ishga tushiradi.
// DATABASE_URL e2e bazaga qaratilgan bo'lishi shart (dev bazaga tegmaslik uchun tekshiriladi).
import { pool } from '../src/db';
import { seedDev } from '../src/seed-dev';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/e2e/.test(url)) throw new Error(`E2E server faqat *e2e* bazada ishlaydi: ${url}`);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await seedDev();
  await import('../src/index');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
