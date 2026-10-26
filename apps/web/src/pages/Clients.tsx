import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { NewClientDialog } from '@/components/NewClientDialog';
import { ClientStatusBadge, TaxBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Empty, QueryState } from '@/components/ui/states';
import { useAccountants } from '@/hooks/tasks';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Client, Paged } from '@/lib/types';

export default function Clients() {
  const { t } = useTranslation();
  const { isLeader } = useAuth();
  const [newOpen, setNewOpen] = useState(false);
  const accountants = useAccountants();
  const [f, setF] = useState({ search: '', status: '', taxType: '', accountantId: '', page: 1, pageSize: 25 });
  const set = (patch: Partial<typeof f>) => setF({ ...f, page: 1, ...patch });
  const q = useQuery({
    queryKey: ['clients', f],
    queryFn: () => api.get<Paged<Client>>(`/clients${qs({ ...f, })}`),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="page-fill">
      <PageHeader
        title={t('clients.title')}
        actions={isLeader && <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> {t('clients.new')}</Button>}
      />
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap gap-2 border-b p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input className="pl-8" placeholder={t('clients.searchPlaceholder')} value={f.search} onChange={(e) => set({ search: e.target.value })} aria-label={t('common.search')} />
          </div>
          <Select className="w-auto min-w-44" value={f.status} onChange={(v) => set({ status: v })} aria-label={t('clients.status')} placeholder={t('clients.allStatuses')} clearable options={['ACTIVE', 'ZERO_REPORT', 'LIQUIDATING'].map((s) => ({ value: s, label: t(`clientStatus.${s}`) }))} />
          <Select className="w-auto min-w-44" value={f.taxType} onChange={(v) => set({ taxType: v })} aria-label={t('clients.taxType')} placeholder={t('clients.allTaxTypes')} clearable options={[{ value: 'AOS', label: 'AOS' }, { value: 'QQS', label: 'QQS' }]} />
          {isLeader && (
            <Select
              className="w-auto min-w-48"
              value={f.accountantId}
              onChange={(v) => set({ accountantId: v })}
              aria-label={t('clients.accountant')}
              placeholder={t('clients.allAccountants')}
              clearable
              options={[{ value: 'none', label: t('clients.noAccountant') }, ...(accountants.data?.map((a) => ({ value: String(a.id), label: a.fullName })) ?? [])]}
            />
          )}
        </div>
        <QueryState q={q}>
          {q.data?.items.length === 0 ? (
            <Empty />
          ) : (
            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="table-head sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-2.5">{t('clients.stir')}</th>
                    <th className="px-4 py-2.5">{t('clients.name')}</th>
                    <th className="px-4 py-2.5">{t('clients.taxType')}</th>
                    <th className="px-4 py-2.5">{t('clients.status')}</th>
                    <th className="px-4 py-2.5">{t('clients.accountant')}</th>
                    <th className="px-4 py-2.5 text-right">{t('clients.openTasks')}</th>
                    <th className="px-4 py-2.5 text-right">{t('clients.overdueTasks')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.items.map((c) => (
                    <tr key={c.id} className="border-t border-gray-200 transition-colors hover:bg-gray-100">
                      <td className="px-4 py-2.5 font-mono text-xs">{c.stir}</td>
                      <td className="px-4 py-2.5"><Link className="font-medium text-brand hover:text-ink" to={`/clients/${c.id}`}>{c.name}</Link></td>
                      <td className="px-4 py-2.5"><TaxBadge taxType={c.taxType} /></td>
                      <td className="px-4 py-2.5"><ClientStatusBadge status={c.status} /></td>
                      <td className="px-4 py-2.5">{c.accountantName ?? <span className="text-gray-400">{t('clients.noAccountant')}</span>}</td>
                      <td className="px-4 py-2.5 text-right">{c.openTasks}</td>
                      <td className="px-4 py-2.5 text-right">{c.overdueTasks ? <span className="font-medium text-overdue">{c.overdueTasks}</span> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            className="shrink-0 border-t px-4 py-2.5"
            page={f.page}
            pageSize={f.pageSize}
            total={q.data?.total ?? 0}
            onPage={(page) => setF({ ...f, page })}
            onPageSize={(pageSize) => set({ pageSize })}
          />
        </QueryState>
      </Card>
      {isLeader && <NewClientDialog open={newOpen} onClose={() => setNewOpen(false)} />}
    </div>
  );
}
