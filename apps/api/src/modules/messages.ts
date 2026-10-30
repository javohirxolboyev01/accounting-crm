import { DateTime } from 'luxon';
import { TZ } from '../common/time';

type Lang = 'uz' | 'ru';

const fmt = (iso?: string | null) =>
  iso ? DateTime.fromISO(iso).setZone(TZ).toFormat('dd.MM.yyyy HH:mm') : '—';

/** Telegram uchun matn (foydalanuvchi tilida). Ilova ichida frontend o'zi i18n qiladi. */
export function renderNotification(kind: string, p: any, lang: Lang): string {
  const uz = lang === 'uz';
  switch (kind) {
    case 'TASK_DONE':
      return uz
        ? `✅ Bajarildi: ${p.taskTitle}\nMijoz: ${p.clientName}\nBuxgalter: ${p.actorName ?? 'tizim'}`
        : `✅ Выполнено: ${p.taskTitle}\nКлиент: ${p.clientName}\nБухгалтер: ${p.actorName ?? 'система'}`;
    case 'TASK_OVERDUE':
      return uz
        ? `🔴 Muddat o'tdi: ${p.taskTitle}\nMijoz: ${p.clientName}\nMuddat: ${fmt(p.dueAt)}\nMas'ul: ${p.assigneeName ?? '—'}`
        : `🔴 Срок истёк: ${p.taskTitle}\nКлиент: ${p.clientName}\nСрок: ${fmt(p.dueAt)}\nОтветственный: ${p.assigneeName ?? '—'}`;
    case 'CLIENTS_OVERDUE': {
      const MAX = 20;
      const list: any[] = p.clients ?? [];
      const lines = list.slice(0, MAX).map((c, i) => {
        const who = p.scope === 'ALL' && c.accountantName ? ` (${c.accountantName})` : '';
        const wait = c.waiting ? (uz ? `, ${c.waiting} tasi mijozdan kutilmoqda` : `, ${c.waiting} ждут клиента`) : '';
        return uz
          ? `${i + 1}. ${c.clientName} — ${c.days} kun, ${c.tasks} ta vazifa${wait}${who}`
          : `${i + 1}. ${c.clientName} — ${c.days} дн., задач: ${c.tasks}${wait}${who}`;
      });
      if (list.length > MAX) lines.push(uz ? `… va yana ${list.length - MAX} ta mijoz` : `… и ещё клиентов: ${list.length - MAX}`);
      const date = p.date ? DateTime.fromISO(p.date).toFormat('dd.MM.yyyy') : '';
      return uz
        ? `⏰ Kechikkan mijozlar (${date})\nEslatma: ${p.clientCount} ta mijoz, ${p.taskCount} ta vazifa (jami kechikkan mijozlar: ${p.totalOverdueClients})\n\n${lines.join('\n')}`
        : `⏰ Просроченные клиенты (${date})\nНапоминание: клиентов ${p.clientCount}, задач ${p.taskCount} (всего просроченных клиентов: ${p.totalOverdueClients})\n\n${lines.join('\n')}`;
    }
    case 'URGENT_TASK':
      return uz
        ? `🚨 Shoshilinch vazifa: ${p.title}\nMijoz: ${p.clientName}\nMuddat: ${fmt(p.dueAt)}\nKim berdi: ${p.createdByName}`
        : `🚨 Срочная задача: ${p.title}\nКлиент: ${p.clientName}\nСрок: ${fmt(p.dueAt)}\nПоставил: ${p.createdByName}`;
    case 'LEAD_WON':
      return uz
        ? `🤝 Yangi mijoz topildi: ${p.leadName}\nSTIR: ${p.stir}\nOperator: ${p.actorName}${p.comment ? `\nIzoh: ${p.comment}` : ''}\nBuxgalter biriktiring.`
        : `🤝 Найден новый клиент: ${p.leadName}\nИНН: ${p.stir}\nОператор: ${p.actorName}${p.comment ? `\nКомментарий: ${p.comment}` : ''}\nНазначьте бухгалтера.`;
    default:
      return uz ? `Bildirishnoma: ${kind}` : `Уведомление: ${kind}`;
  }
}

export const telegramTexts = {
  linked: { uz: 'Telegram hisobingiz CRM bilan bog\'landi ✅', ru: 'Telegram привязан к CRM ✅' },
  badCode: {
    uz: 'Kod noto\'g\'ri yoki muddati o\'tgan. Profil sahifasidan yangi kod oling.',
    ru: 'Код неверный или устарел. Получите новый код на странице профиля.',
  },
  help: {
    uz: 'Bog\'lash uchun: profil sahifasidagi kodni /start <kod> ko\'rinishida yuboring.',
    ru: 'Для привязки отправьте /start <код> с кодом из профиля.',
  },
};
