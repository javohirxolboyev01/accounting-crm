import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { MonthPicker } from '@/components/ui/date-picker';
import { Field, Input } from '@/components/ui/input';
import { Empty, QueryState } from '@/components/ui/states';
import { invalidateTasks } from '@/hooks/tasks';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { errorText } from '@/lib/errors';
import { currentMonth, fmtDateTime } from '@/lib/time';
import type { ImportReport, ReviewItem, SheetsStatus } from '@/lib/types';

const actionCls = {
  NEW: 'border-green-300 bg-green-50 text-green-700',
  UPDATED: 'border-blue-300 bg-blue-50 text-blue-700',
  UNCHANGED: 'border-gray-200 text-gray-500',
  SKIPPED: 'border-red-300 bg-red-50 text-red-700',
};

function ImportCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [source, setSource] = useState<'file' | 'google'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [google, setGoogle] = useState({ spreadsheetId: '', sheetTitle: '' });
  const [month, setMonth] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const query = qs({ dryRun, month: month || undefined });
      if (source === 'file') {
        const fd = new FormData();
        fd.append('file', file!);
        return api.post<ImportReport>(`/sheets/import${query}`, fd);
      }
      return api.post<ImportReport>(`/sheets/import${query}`, google);
    },
    onSuccess: (r) => {
      setReport(r);
      if (!r.dryRun) {
        toast.success(t('sheets.imported', { created: r.summary.created, updated: r.summary.updated }));
        invalidateTasks(qc);
        void qc.invalidateQueries({ queryKey: ['sheets'] });
      }
    },
    onError: (e) => toast.error(errorText(e, t)),
  });

  const downloadCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `import-${report.period}${report.dryRun ? '-dry-run' : ''}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const ready = source === 'file' ? !!file : !!google.spreadsheetId && !!google.sheetTitle;

  return (
    <Card>
      <CardHeader title={t('sheets.import')} />
      <div className="space-y-4 p-4 text-sm">
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="radio" checked={source === 'file'} onChange={() => setSource('file')} /> {t('sheets.fromFile')}</label>
          <label className="flex items-center gap-2"><input type="radio" checked={source === 'google'} onChange={() => setSource('google')} /> Google Sheets</label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {source === 'file' ? (
            <Field label={t('sheets.file')}><Input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} /></Field>
          ) : (
            <>
              <Field label={t('sheets.spreadsheetId')}><Input value={google.spreadsheetId} onChange={(e) => setGoogle({ ...google, spreadsheetId: e.target.value })} /></Field>
              <Field label={t('sheets.sheetTitle')}><Input value={google.sheetTitle} onChange={(e) => setGoogle({ ...google, sheetTitle: e.target.value })} /></Field>
            </>
          )}
          <Field label={t('sheets.period')} hint={t('sheets.periodHint')}><MonthPicker value={month} onChange={setMonth} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!ready || run.isPending} onClick={() => run.mutate(true)}><Upload className="h-4 w-4" /> {t('sheets.dryRun')}</Button>
          <Button disabled={!ready || !report?.dryRun || run.isPending} onClick={() => run.mutate(false)}>{t('sheets.applyImport')}</Button>
          {report && <Button variant="ghost" onClick={downloadCsv}><Download className="h-4 w-4" /> CSV</Button>}
        </div>
        {report && (
          <div className="space-y-3">
            <div className={cn('rounded-md border p-3', report.dryRun ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50')}>
              <b>{report.dryRun ? t('sheets.dryRunResult') : t('sheets.importResult')}</b> · {t('sheets.period')}: {report.period}
              <div className="mt-1 flex flex-wrap gap-x-4 text-xs">
                <span>{t('common.total')}: {report.summary.total}</span>
                <span className="text-green-700">{t('sheets.new')}: {report.summary.created}</span>
                <span className="text-blue-700">{t('sheets.updated')}: {report.summary.updated}</span>
                <span>{t('sheets.unchanged')}: {report.summary.unchanged}</span>
                <span className="text-red-700">{t('sheets.skipped')}: {report.summary.skipped}</span>
                <span className="text-amber-700">{t('sheets.review')}: {report.summary.review}</span>
                <span>{t('sheets.cellsDone')}: {report.summary.cellsDone}</span>
              </div>
              <div className="mt-1 text-xs text-gray-600">{t('sheets.columns')}: {report.columns.map((c) => c.code).join(', ')}</div>
            </div>
            <div className="max-h-96 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 table-head">
                  <tr><th className="px-3 py-1.5">#</th><th className="px-3 py-1.5">{t('clients.stir')}</th><th className="px-3 py-1.5">{t('clients.name')}</th><th className="px-3 py-1.5">{t('sheets.action')}</th><th className="px-3 py-1.5">{t('sheets.reviewNotes')}</th></tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.row} className={cn('border-t', r.review.length && 'bg-amber-50/60')}>
                      <td className="px-3 py-1.5">{r.row}</td>
                      <td className="px-3 py-1.5 font-mono">{r.stir}</td>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5"><Badge className={actionCls[r.action]}>{t(`sheets.actions.${r.action}`)}</Badge> {r.changes.join(', ')}</td>
                      <td className="px-3 py-1.5 text-amber-800">{r.review.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ReviewCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sheets', 'review'], queryFn: () => api.get<ReviewItem[]>('/sheets/review') });
  const resolve = useMutation({
    mutationFn: (id: number) => api.post(`/sheets/errors/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheets'] }),
    onError: (e) => toast.error(errorText(e, t)),
  });
  return (
    <Card>
      <CardHeader title={`${t('sheets.manualReview')} (${q.data?.length ?? 0})`} />
      <QueryState q={q}>
        {q.data?.length === 0 && <Empty />}
        <ul className="max-h-96 divide-y overflow-y-auto text-sm">
          {q.data?.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2">
              <div className="flex-1">
                <div>{r.message}</div>
                <div className="text-xs text-gray-500">{r.ref} · {r.stir ?? '—'} · {fmtDateTime(r.occurredAt)}</div>
              </div>
              {r.clientId && <Link className="text-xs text-brand hover:underline" to={`/clients/${r.clientId}`}>{t('sheets.fixInCard')}</Link>}
              <Button size="sm" variant="outline" onClick={() => resolve.mutate(r.id)}>{t('sheets.resolve')}</Button>
            </li>
          ))}
        </ul>
      </QueryState>
    </Card>
  );
}

function SyncCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sheets', 'status'], queryFn: () => api.get<SheetsStatus>('/sheets/status'), refetchInterval: 30_000 });
  const [cfg, setCfg] = useState({ spreadsheetId: '', sheetTitle: '', month: currentMonth() });
  const onErr = (e: unknown) => toast.error(errorText(e, t));
  const refresh = () => qc.invalidateQueries({ queryKey: ['sheets'] });
  const save = useMutation({ mutationFn: () => api.put('/sheets/config', { ...cfg, spreadsheetId: cfg.spreadsheetId || q.data?.defaultSpreadsheetId, enabled: true }), onSuccess: () => { toast.success(t('common.saved')); void refresh(); }, onError: onErr });
  const sync = useMutation({ mutationFn: (stateId?: number) => api.post('/sheets/sync', { stateId }), onSuccess: () => { toast.success(t('sheets.synced')); invalidateTasks(qc); void refresh(); }, onError: onErr });
  const resolve = useMutation({ mutationFn: (id: number) => api.post(`/sheets/errors/${id}/resolve`), onSuccess: refresh, onError: onErr });
  const s = q.data;
  return (
    <Card>
      <CardHeader title={t('sheets.sync')} actions={<Button size="sm" disabled={!s?.googleConfigured || sync.isPending} onClick={() => sync.mutate(undefined)}><RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} /> {t('sheets.syncNow')}</Button>} />
      <QueryState q={q}>
        {s && (
          <div className="space-y-4 p-4 text-sm">
            {!s.googleConfigured && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800">{t('sheets.notConfigured')}</p>}
            <p className="text-xs text-gray-500">{t('sheets.syncHint', { min: s.intervalMinutes })}</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={t('sheets.spreadsheetId')}><Input placeholder={s.defaultSpreadsheetId ?? ''} value={cfg.spreadsheetId} onChange={(e) => setCfg({ ...cfg, spreadsheetId: e.target.value })} /></Field>
              <Field label={t('sheets.sheetTitle')}><Input value={cfg.sheetTitle} onChange={(e) => setCfg({ ...cfg, sheetTitle: e.target.value })} /></Field>
              <Field label={t('sheets.period')}><MonthPicker value={cfg.month} onChange={(v) => setCfg({ ...cfg, month: v })} /></Field>
              <div className="flex items-end"><Button variant="outline" disabled={!cfg.sheetTitle || !(cfg.spreadsheetId || s.defaultSpreadsheetId)} onClick={() => save.mutate()}>{t('sheets.addSheet')}</Button></div>
            </div>
            {s.states.length > 0 && (
              <table className="w-full text-xs">
                <thead className="table-head"><tr><th className="px-3 py-2">{t('sheets.sheetTitle')}</th><th className="px-3 py-2">{t('sheets.period')}</th><th className="px-3 py-2">{t('sheets.lastSync')}</th><th className="px-3 py-2">{t('common.status')}</th><th className="px-3 py-2" /></tr></thead>
                <tbody>
                  {s.states.map((st) => (
                    <tr key={st.id} className="border-t border-gray-200 transition-colors hover:bg-gray-100">
                      <td className="px-3 py-1.5">{st.sheetTitle}</td>
                      <td className="px-3">{st.month}</td>
                      <td className="px-3">{fmtDateTime(st.lastSyncedAt)}</td>
                      <td className="px-3">
                        <span className={cn(st.status === 'ERROR' && 'text-red-700', st.status === 'OK' && 'text-green-700')}>{st.status}</span>
                        {st.details?.appliedToSystem !== undefined && <span className="ml-2 text-gray-500">↓{st.details.appliedToSystem} ↑{st.details.writtenToSheet} ⚡{st.details.conflicts}</span>}
                        {st.details?.error && <div className="text-red-700">{st.details.error}</div>}
                      </td>
                      <td className="text-right"><Button size="sm" variant="ghost" disabled={!s.googleConfigured} onClick={() => sync.mutate(st.id)}>{t('sheets.syncNow')}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div>
              <h3 className="mb-2 font-medium">{t('sheets.errors')} ({s.errors.length})</h3>
              {s.errors.length === 0 ? <p className="text-xs text-gray-500">{t('sheets.noErrors')}</p> : (
                <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                  {s.errors.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                      <span className="flex-1">{e.ref} · {e.stir ?? ''} · {e.message} {e.rawValue && <code className="rounded bg-gray-100 px-1">{e.rawValue}</code>}</span>
                      <span className="text-gray-500">{fmtDateTime(e.occurredAt)}</span>
                      <Button size="sm" variant="ghost" onClick={() => resolve.mutate(e.id)}>{t('sheets.resolve')}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </QueryState>
    </Card>
  );
}

export default function Sheets() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <PageHeader title={t('sheets.title')} />
      <ImportCard />
      <ReviewCard />
      <SyncCard />
    </div>
  );
}
