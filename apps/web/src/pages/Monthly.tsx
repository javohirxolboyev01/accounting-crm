import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Empty, QueryState } from '@/components/ui/states';
import { TableSkeleton } from '@/components/ui/skeleton';
import { useAccountants, useMarkDone } from '@/hooks/tasks';
import { useOpenTask } from '@/hooks/outlet';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { currentMonth, fmtDayMonth, monthLabel, shiftMonth } from '@/lib/time';
import type { CellState, Grid } from '@/lib/types';

const CELL: Record<CellState, { sym: string; cls: string }> = {
  '1': { sym: '✓', cls: 'bg-done-bg text-done font-semibold' },
  '0': { sym: '○', cls: 'font-semibold text-gray-600 hover:bg-blue-50 dark:text-on-brand' },
  '!': { sym: '!', cls: 'bg-overdue-bg text-overdue font-bold hover:bg-red-200' },
  X: { sym: '—', cls: 'bg-gray-100 font-semibold text-gray-600 dark:text-on-brand' },
};

export default function Monthly() {
  const { t, i18n } = useTranslation();
  const { isLeader } = useAuth();
  const accountants = useAccountants();
  const done = useMarkDone();
  const openTask = useOpenTask();
  const [month, setMonth] = useState(currentMonth());
  const [f, setF] = useState({ accountantId: '', taxType: '', status: '', search: '' });
  const q = useQuery({
    queryKey: ['grid', month, f],
    queryFn: () => api.get<Grid>(`/monthly-grid${qs({ month, ...f })}`),
    placeholderData: (prev) => prev,
  });
  const g = q.data;
  const colName = (c: Grid['columns'][number]) => (i18n.language === 'ru' ? c.nameRu : c.name);

  return (
    <div>
      <PageHeader
        title={t('monthly.title')}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t('common.prev')}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[140px] text-center text-sm font-medium capitalize">{monthLabel(month, t('months', { returnObjects: true }) as string[])}</span>
            <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t('common.next')}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input className="max-w-xs" placeholder={t('clients.searchPlaceholder')} value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} aria-label={t('common.search')} />
          {isLeader && (
            <Select
              className="w-auto min-w-48"
              value={f.accountantId}
              onChange={(v) => setF({ ...f, accountantId: v })}
              aria-label={t('clients.accountant')}
              placeholder={t('clients.allAccountants')}
              clearable
              options={accountants.data?.map((a) => ({ value: String(a.id), label: a.fullName })) ?? []}
            />
          )}
          <Select className="w-auto min-w-44" value={f.taxType} onChange={(v) => setF({ ...f, taxType: v })} aria-label={t('clients.taxType')} placeholder={t('clients.allTaxTypes')} clearable options={[{ value: 'AOS', label: 'AOS' }, { value: 'QQS', label: 'QQS' }]} />
          <Select className="w-auto min-w-44" value={f.status} onChange={(v) => setF({ ...f, status: v })} aria-label={t('clients.status')} placeholder={t('clients.allStatuses')} clearable options={['ACTIVE', 'ZERO_REPORT', 'LIQUIDATING'].map((s) => ({ value: s, label: t(`clientStatus.${s}`) }))} />
          <div className="ml-auto flex flex-wrap gap-3 text-xs text-gray-600">
            {(['1', '0', '!', 'X'] as CellState[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded border', CELL[s].cls)}>{CELL[s].sym}</span>
                {t(`monthly.legend.${s === '!' ? 'overdue' : s === 'X' ? 'na' : s === '1' ? 'done' : 'open'}`)}
              </span>
            ))}
          </div>
        </div>
        <QueryState q={q} skeleton={<TableSkeleton rows={12} cols={10} />}>
          {!g?.rows?.length && <Empty text={t('monthly.empty')} />}
          {g && g.rows?.length > 0 && (
            // ~100 qator x ~10 ustun: oddiy jadval yetarli (virtualizatsiya shart emas)
            <div className="max-h-[calc(100vh-240px)] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="sticky left-0 top-0 z-20 min-w-[220px] border-r border-brand-400 px-3 py-2.5 text-left text-xs">{t('monthly.client')}</th>
                    <th className="sticky top-0 z-10 border-r border-brand-400 px-2 py-2.5 text-xs">{t('clients.taxType')}</th>
                    {g.columns.map((c) => (
                      <th key={c.reportTypeId} className="sticky top-0 z-10 min-w-[84px] border-r border-brand-400 px-2 py-2.5 text-center text-xs last:border-r-0" title={colName(c)}>
                        <div className="max-w-[120px] truncate">{c.code === 'TOLOV_MANBAI' ? t('monthly.tolovShort') : c.code === 'PORUCHENYA_JSHDS' ? t('monthly.poruchShort') : colName(c)}</div>
                        <div className="font-normal text-on-brand/80">{c.dueDate ? fmtDayMonth(c.dueDate) : '—'}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.clientId} className="group">
                      <td className="sticky left-0 z-10 border-b border-r bg-white p-0 group-hover:bg-gray-100">
                        {/* Butun katak bosiladi */}
                        <Link to={`/clients/${r.clientId}`} className="block px-3 py-1.5">
                          <div className="w-fit font-medium text-brand-500 hover:text-ink dark:text-brand-400 dark:hover:text-ink">{r.name}</div>
                          <div className="text-[11px] text-gray-500">{r.stir} · {r.accountantName ?? '—'}{r.status !== 'ACTIVE' && ` · ${t(`clientStatus.${r.status}`)}`}</div>
                        </Link>
                      </td>
                      <td className="border-b px-2 text-center text-xs">{r.taxType}</td>
                      {g.columns.map((c) => {
                        const cell = r.cells[c.reportTypeId];
                        if (!cell) return <td key={c.reportTypeId} className="border-b" />;
                        const meta = CELL[cell.state];
                        const clickable = cell.state !== 'X' && cell.state !== '1' && cell.taskId;
                        return (
                          <td key={c.reportTypeId} className="border-b p-0.5 text-center">
                            {clickable ? (
                              <button
                                className={cn('h-8 w-full rounded', meta.cls)}
                                title={t('monthly.clickHint')}
                                aria-label={`${r.name} — ${colName(c)}: ${t('monthly.clickHint')}`}
                                onClick={() => done.mutate({ taskId: cell.taskId!, viaGrid: true })}
                                onContextMenu={(e) => { e.preventDefault(); openTask(cell.taskId!); }}
                              >
                                {meta.sym}
                              </button>
                            ) : (
                              <button
                                className={cn('h-8 w-full cursor-default rounded', meta.cls, cell.taskId && 'cursor-pointer')}
                                disabled={!cell.taskId}
                                onClick={() => cell.taskId && openTask(cell.taskId)}
                                aria-label={`${r.name} — ${colName(c)}: ${t(`monthly.legend.${cell.state === 'X' ? 'na' : 'done'}`)}`}
                              >
                                {meta.sym}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Card>
      <p className="mt-2 text-xs text-gray-500">{t('monthly.hint')}</p>
    </div>
  );
}
