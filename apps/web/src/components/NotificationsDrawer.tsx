import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CheckCheck, CircleCheck, Clock, Siren, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pagination } from '@/components/ui/pagination';
import { Empty, QueryState } from '@/components/ui/states';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtRelative } from '@/lib/time';
import type { AppNotification, NotificationKind, Paged } from '@/lib/types';

const params = (n: AppNotification, t: TFunction) => {
  const p = n.payload ?? {};
  return {
    title: p.taskTitle ?? p.title ?? '',
    client: p.clientName ?? '',
    actor: p.actorName ?? t('notif.system'),
    due: p.dueAt ? fmtDateTime(p.dueAt) : '—',
    assignee: p.assigneeName ?? '—',
    createdBy: p.createdByName ?? '',
  };
};

/** Bir qatorli matn (toast xabarlari uchun) */
export function notificationText(n: AppNotification, t: TFunction) {
  return t(`notif.${n.kind}`, params(n, t));
}

// Tur bo'yicha ko'rinish: chap chiziq, belgi foni va rangi
const KIND_STYLE: Record<NotificationKind, { icon: LucideIcon; border: string; tile: string }> = {
  URGENT_TASK: { icon: Siren, border: 'border-l-red-500', tile: 'bg-red-50 text-red-500' },
  TASK_OVERDUE: { icon: Clock, border: 'border-l-amber-400', tile: 'bg-amber-50 text-amber-500' },
  TASK_DONE: { icon: CircleCheck, border: 'border-l-green-500', tile: 'bg-green-50 text-green-600' },
};

/** Bildirishnomalar: alohida sahifa emas, headerdagi qo'ng'iroqdan o'ngdan ochiladigan panel */
export function NotificationsDrawer({ open, onClose, onOpenTask }: { open: boolean; onClose: () => void; onOpenTask: (id: number) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['notifications', 'list', page],
    queryFn: () => api.get<Paged<AppNotification>>(`/notifications${qs({ page })}`),
    enabled: open,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
  const read = useMutation({ mutationFn: (id: number) => api.post(`/notifications/${id}/read`), onSuccess: refresh });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const hasUnread = q.data?.items.some((n) => !n.readAt);

  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in justify-end bg-black/50" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-title"
        className="flex h-full w-full max-w-[380px] animate-slide-in flex-col bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900 active:scale-95"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <h2 id="notif-title" className="flex-1 truncate text-base font-semibold text-foreground">{t('notif.title')}</h2>
          <button
            type="button"
            onClick={() => readAll.mutate()}
            disabled={!hasUnread || readAll.isPending}
            title={t('notif.markAll')}
            aria-label={t('notif.markAll')}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-brand-500 text-brand-500 transition-all hover:bg-brand-50 active:scale-95 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-brand-900/40"
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="custom-scrollbar flex-1 overflow-y-auto">
          <QueryState q={q}>
            {!q.data?.items?.length && <Empty text={t('notif.empty')} />}
            <ul className="divide-y divide-gray-200">
              {q.data?.items.map((n) => {
                const st = KIND_STYLE[n.kind] ?? KIND_STYLE.TASK_DONE;
                const when = n.deliveredAt ?? n.createdAt;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full cursor-pointer items-start gap-2.5 border-l-[3px] px-3.5 py-2.5 text-left transition-colors',
                        st.border,
                        n.readAt ? 'bg-white hover:bg-gray-50' : 'bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-50/50 dark:hover:bg-blue-100/50',
                      )}
                      onClick={() => {
                        if (!n.readAt) read.mutate(n.id);
                        if (n.taskId) {
                          onClose();
                          onOpenTask(n.taskId);
                        }
                      }}
                    >
                      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', st.tile)}>
                        <st.icon className="h-3 w-3" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn('text-[13px] leading-5 text-foreground', n.readAt ? 'font-medium' : 'font-semibold')}>{t(`notif.heading.${n.kind}`)}</span>
                          <time dateTime={when} title={fmtDateTime(when)} className="shrink-0 text-[11px] text-gray-400">
                            {fmtRelative(when, t)}
                          </time>
                        </span>
                        <span className="block text-[11px] leading-snug text-gray-500">{t(`notif.body.${n.kind}`, params(n, t))}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {q.data && q.data.total > q.data.pageSize && (
              <Pagination compact className="border-t border-gray-200 px-4 py-3" page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
            )}
          </QueryState>
        </div>
      </aside>
    </div>
  );
}
