import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, DatabaseZap, Download, Eye, FileSpreadsheet, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { MonthPicker } from '@/components/ui/date-picker';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Empty, QueryState } from '@/components/ui/states';
import { FormSkeleton } from '@/components/ui/skeleton';
import { invalidateTasks } from '@/hooks/tasks';
import { ApiError, api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { errorText } from '@/lib/errors';
import { currentMonth, fmtDateTime } from '@/lib/time';
import type { ImportReport, PreviousImport, ReviewItem, SheetsStatus } from '@/lib/types';

const actionCls = {
  NEW: 'border-green-300 bg-green-50 text-green-700',
  UPDATED: 'border-blue-300 bg-blue-50 text-blue-700',
  UNCHANGED: 'border-gray-200 text-gray-500',
  SKIPPED: 'border-red-300 bg-red-50 text-red-700',
};

type RowFilter = 'ALL' | 'NEW' | 'UPDATED' | 'UNCHANGED' | 'SKIPPED' | 'REVIEW';

const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** 1 → 2 → 3 qadamlar: fayl tanlash, tekshirish (bazaga yozilmaydi), CRM'ga yuklash */
function ImportSteps({ step }: { step: 1 | 2 | 3 | 4 }) {
  const { t } = useTranslation();
  const steps = [t('sheets.step.choose'), t('sheets.step.preview'), t('sheets.step.apply')];
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-400" aria-hidden />}
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                done ? 'bg-green-600 text-on-brand' : active ? 'bg-brand-500 text-on-brand' : 'bg-gray-100 text-gray-500',
              )}
            >
              {done ? <Check className="h-3 w-3" /> : n}
            </span>
            <span className={cn(active ? 'font-medium text-gray-900' : 'text-gray-500')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Native "Choose File" o'rniga: bosib tanlash yoki sudrab tashlash */
function FileDrop({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5 dark:border-brand-800 dark:bg-brand-950/30">
        <FileSpreadsheet className="h-8 w-8 shrink-0 text-green-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900">{file.name}</div>
          <div className="text-xs text-gray-500">{fmtSize(file.size)}</div>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onChange(null)} aria-label={t('sheets.removeFile')} title={t('sheets.removeFile')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 transition-colors',
        over ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50',
      )}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onChange(f);
      }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        <Upload className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">{t('sheets.chooseFile')}</span>
        <span className="block text-xs text-gray-500">{t('sheets.fileHint')}</span>
      </span>
      <input
        type="file"
        accept=".xlsx"
        className="sr-only"
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function ImportCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [source, setSource] = useState<'file' | 'google'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [google, setGoogle] = useState({ spreadsheetId: '', sheetTitle: '' });
  const [month, setMonth] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [filter, setFilter] = useState<RowFilter>('ALL');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Kiritilgan narsa o'zgarsa eski natija endi unga tegishli emas
  const resetReport = () => { setReport(null); setFilter('ALL'); };

  const warnDuplicate = (p: PreviousImport) =>
    toast.warning(t('sheets.alreadyImported'), {
      description: t('sheets.alreadyImportedDesc', { name: p.fileName, at: fmtDateTime(p.importedAt), by: p.importedBy ?? '—' }),
      duration: 8000,
    });

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
      setFilter('ALL');
      if (r.alreadyImported) warnDuplicate(r.alreadyImported);
      if (!r.dryRun) {
        toast.success(t('sheets.imported', { created: r.summary.created, updated: r.summary.updated }));
        setFile(null);
        invalidateTasks(qc);
        void qc.invalidateQueries({ queryKey: ['sheets'] });
      }
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'FILE_ALREADY_IMPORTED') warnDuplicate(e.details as PreviousImport);
      else toast.error(errorText(e, t));
    },
  });

  const downloadCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `import-${report.period}${report.dryRun ? '-dry-run' : ''}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const ready = source === 'file' ? !!file : !!google.spreadsheetId && !!google.sheetTitle;
  const previewed = !!report?.dryRun;
  const duplicate = !!report?.alreadyImported;
  const step = report && !report.dryRun ? 4 : previewed ? 3 : ready ? 2 : 1;
  // Tekshirmasdan yuklashda bir marta so'raladi: rahbar nima yozilishini ko'rmagan
  const apply = () => (previewed ? run.mutate(false) : setConfirmOpen(true));

  const s = report?.summary;
  const tiles: { key: RowFilter; label: string; value: number; cls: string }[] = s
    ? [
        { key: 'ALL', label: t('common.total'), value: s.total, cls: 'text-gray-900' },
        { key: 'NEW', label: t('sheets.new'), value: s.created, cls: 'text-green-700' },
        { key: 'UPDATED', label: t('sheets.updated'), value: s.updated, cls: 'text-blue-700' },
        { key: 'UNCHANGED', label: t('sheets.unchanged'), value: s.unchanged, cls: 'text-gray-600' },
        { key: 'SKIPPED', label: t('sheets.skipped'), value: s.skipped, cls: 'text-red-700' },
        { key: 'REVIEW', label: t('sheets.review'), value: s.review, cls: 'text-amber-700' },
      ]
    : [];
  const rows = (report?.rows ?? []).filter((r) =>
    filter === 'ALL' ? true : filter === 'REVIEW' ? r.review.length > 0 : r.action === filter,
  );

  return (
    <Card>
      <CardHeader title={t('sheets.import')} />
      <div className="space-y-5 px-4 pb-4 text-sm">
        <ImportSteps step={step} />

        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="radio" className="accent-brand-500" checked={source === 'file'} onChange={() => { setSource('file'); resetReport(); }} /> {t('sheets.fromFile')}</label>
          <label className="flex items-center gap-2"><input type="radio" className="accent-brand-500" checked={source === 'google'} onChange={() => { setSource('google'); resetReport(); }} /> Google Sheets</label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {source === 'file' ? (
            <div className="lg:col-span-2">
              <Field label={t('sheets.file')}><FileDrop file={file} onChange={(f) => { setFile(f); resetReport(); }} /></Field>
            </div>
          ) : (
            <>
              <Field label={t('sheets.spreadsheetId')}><Input value={google.spreadsheetId} onChange={(e) => { setGoogle({ ...google, spreadsheetId: e.target.value }); resetReport(); }} /></Field>
              <Field label={t('sheets.sheetTitle')}><Input value={google.sheetTitle} onChange={(e) => { setGoogle({ ...google, sheetTitle: e.target.value }); resetReport(); }} /></Field>
            </>
          )}
          <Field label={t('sheets.period')} hint={t('sheets.periodHint')}><MonthPicker value={month} onChange={(v) => { setMonth(v); resetReport(); }} /></Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-3">
            <Button variant="outline" className="w-full" disabled={!ready || run.isPending} loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>
              <Eye className="h-4 w-4" /> {t('sheets.dryRun')}
            </Button>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden /> {t('sheets.dryRunHint')}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <Button className="w-full" disabled={!ready || duplicate || run.isPending} loading={run.isPending && run.variables === false} onClick={apply}>
              <DatabaseZap className="h-4 w-4" /> {t('sheets.applyImport')}
            </Button>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden /> {t('sheets.applyHint')}
            </p>
          </div>
        </div>

        {report && s && (
          <div className="space-y-3">
            {report.dryRun ? (
              duplicate ? (
                <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div>
                    <div className="font-semibold">{t('sheets.alreadyImported')}</div>
                    <div className="text-xs">{t('sheets.alreadyImportedDesc', { name: report.alreadyImported!.fileName, at: fmtDateTime(report.alreadyImported!.importedAt), by: report.alreadyImported!.importedBy ?? '—' })}</div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-950/40">
                  <Eye className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900">{t('sheets.dryRunResult')} · {report.period}</div>
                    <div className="text-xs text-gray-600">{t('sheets.dryRunNext')}</div>
                  </div>
                  <Button disabled={run.isPending} loading={run.isPending && run.variables === false} onClick={() => run.mutate(false)}>
                    <DatabaseZap className="h-4 w-4" /> {t('sheets.applyImport')}
                  </Button>
                </div>
              )
            ) : (
              <div className="flex items-start gap-3 rounded-lg border border-green-300 bg-green-50 p-3 text-green-800">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <div>
                  <div className="font-semibold">{t('sheets.importResult')} · {report.period}</div>
                  <div className="text-xs">{t('sheets.importDone', { cells: s.cellsDone, review: s.review })}</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {tiles.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setFilter(x.key)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition-colors',
                    filter === x.key ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-gray-200 hover:bg-gray-50',
                  )}
                >
                  <div className={cn('text-lg font-semibold tabular-nums', x.cls)}>{x.value}</div>
                  <div className="truncate text-xs text-gray-500">{x.label}</div>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>{t('sheets.columns')}: {report.columns.map((c) => c.code).join(', ')} · {t('sheets.cellsDone')}: {s.cellsDone}</span>
              <Button size="sm" variant="ghost" onClick={downloadCsv}><Download className="h-4 w-4" /> CSV</Button>
            </div>

            <div className="max-h-96 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 table-head">
                  <tr><th className="px-3 py-1.5">#</th><th className="px-3 py-1.5">{t('clients.stir')}</th><th className="px-3 py-1.5">{t('clients.name')}</th><th className="px-3 py-1.5">{t('sheets.action')}</th><th className="px-3 py-1.5">{t('sheets.reviewNotes')}</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">{t('sheets.noRows')}</td></tr>}
                  {rows.map((r) => (
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

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('sheets.confirmTitle')}
        footer={
          <>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); run.mutate(true); }}><Eye className="h-4 w-4" /> {t('sheets.dryRun')}</Button>
            <Button onClick={() => { setConfirmOpen(false); run.mutate(false); }}><DatabaseZap className="h-4 w-4" /> {t('sheets.confirmApply')}</Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">{t('sheets.confirmText')}</p>
      </Dialog>
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
        {!q.data?.length && <Empty />}
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
      <QueryState q={q} skeleton={<FormSkeleton fields={4} />}>
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
