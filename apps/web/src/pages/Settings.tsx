import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/input';
import { Empty, QueryState } from '@/components/ui/states';
import { TableSkeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { errorText } from '@/lib/errors';
import { fmtDate } from '@/lib/time';
import type { ReportType, RoutineWork, UrgentTemplate } from '@/lib/types';

type Tab = 'reports' | 'routines' | 'templates' | 'general';
const MAX_ROUTINES = 10;

/** Tahrir -> "Saqlash" -> o'zgarishlar xulosasi -> tasdiqlash */
function useDraft<T extends { id: number }>(server: T[] | undefined) {
  const [draft, setDraft] = useState<T[]>([]);
  useEffect(() => setDraft(server ? structuredClone(server) : []), [server]);
  const changes = draft
    .map((d) => {
      const s = server?.find((x) => x.id === d.id);
      if (!s) return null;
      const fields = (Object.keys(d) as (keyof T)[]).filter((k) => JSON.stringify(d[k]) !== JSON.stringify(s[k]));
      return fields.length ? { row: d, before: s, fields } : null;
    })
    .filter((x): x is { row: T; before: T; fields: (keyof T)[] } => x !== null);
  const update = (id: number, patch: Partial<T>) => setDraft((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  return { draft, setDraft, changes, update, reset: () => setDraft(server ? structuredClone(server) : []) };
}

function Summary({ open, onClose, onConfirm, lines, busy }: { open: boolean; onClose: () => void; onConfirm: () => void; lines: string[]; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('settings.summaryTitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={onConfirm} disabled={busy}>{t('common.confirm')}</Button>
        </>
      }
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <p className="mt-3 text-xs text-gray-500">{t('settings.summaryNote')}</p>
    </Dialog>
  );
}

const fmtVal = (v: unknown, t: (k: string) => string) =>
  v === true ? t('common.yes') : v === false ? t('common.no') : v === null || v === undefined ? '—' : Array.isArray(v) ? v.join(', ') : String(v);

function ReportTypesTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'report-types'], queryFn: () => api.get<ReportType[]>('/settings/report-types') });
  const { draft, changes, update, reset } = useDraft(q.data);
  const [summary, setSummary] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      for (const c of changes) {
        const body: Record<string, unknown> = {};
        for (const f of c.fields) body[f as string] = c.row[f];
        await api.patch(`/settings/report-types/${c.row.id}`, body);
      }
    },
    onSuccess: () => {
      setSummary(false);
      toast.success(t('common.saved'));
      // Muddat kuni karta, vazifalar va jadvallarda ham ko'rinadi: hammasi yangilansin
      for (const key of ['settings', 'grid', 'client', 'tasks', 'works', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast.error(errorText(e, t)),
  });
  const lines = changes.flatMap((c) =>
    c.fields.map((f) => `${c.row.name}: ${t(`settings.field.${String(f)}`)} — ${fmtVal(c.before[f], t)} → ${fmtVal(c.row[f], t)}`),
  );

  return (
    <Card>
      <CardHeader
        title={t('settings.reportTypes')}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={!changes.length} onClick={reset}>{t('common.reset')}</Button>
            <Button size="sm" disabled={!changes.length} onClick={() => setSummary(true)}>{t('common.save')} {changes.length ? `(${changes.length})` : ''}</Button>
          </>
        }
      />
      <QueryState q={q} skeleton={<TableSkeleton rows={10} cols={8} />}>
        {!draft.length ? <Empty /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-3 py-2">{t('settings.report')}</th>
                <th className="px-3 py-2">{t('settings.frequency')}</th>
                <th className="px-3 py-2">{t('settings.field.dueDay')}</th>
                <th className="px-3 py-2">{t('settings.field.generationMonths')}</th>
                <th className="px-3 py-2 text-center">AOS</th>
                <th className="px-3 py-2 text-center">QQS</th>
                <th className="px-3 py-2 text-center">{t('settings.field.createsAccountantTask')}</th>
                <th className="px-3 py-2 text-center">{t('settings.field.active')}</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((r) => {
                const changed = changes.some((c) => c.row.id === r.id);
                return (
                  <tr key={r.id} className={cn('border-t', changed && 'bg-amber-50')}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{i18n.language === 'ru' ? r.nameRu : r.name}</div>
                      <div className="text-xs text-gray-500">{r.code}{r.requiresEventFlag && ` · ${t('settings.eventOnly')}`}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{t(`settings.freq.${r.frequency}`)}</td>
                    <td className="px-3 py-2">
                      {/* Yillik hisobotlarda muddat kuni yo'q (V16): katak har oy chiqadi, muddati o'tmaydi */}
                      {r.frequency === 'YEARLY' ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <Input type="number" min={1} max={31} className="h-8 w-20" value={r.dueDay ?? ''} placeholder="?" onChange={(e) => update(r.id, { dueDay: e.target.value ? Number(e.target.value) : null })} aria-label={t('settings.field.dueDay')} />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.frequency === 'MONTHLY' || r.generationMonths?.length === 12 ? (
                        <span className="text-xs text-gray-400">{t('settings.everyMonth')}</span>
                      ) : (
                        <Input
                          className="h-8 w-28"
                          value={(r.generationMonths ?? []).join(',')}
                          onChange={(e) => {
                            const months = e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= 12);
                            update(r.id, { generationMonths: months.length ? months : r.generationMonths });
                          }}
                          aria-label={t('settings.field.generationMonths')}
                        />
                      )}
                    </td>
                    {(['appliesToAos', 'appliesToQqs', 'createsAccountantTask', 'active'] as const).map((k) => (
                      <td key={k} className="px-3 py-2 text-center">
                        <input type="checkbox" className="h-4 w-4" checked={r[k]} onChange={(e) => update(r.id, { [k]: e.target.checked } as Partial<ReportType>)} aria-label={`${r.code} ${t(`settings.field.${k}`)}`} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        <p className="px-4 py-3 text-xs text-gray-500">{t('settings.reportTypesHint')}</p>
      </QueryState>
      <Summary open={summary} onClose={() => setSummary(false)} onConfirm={() => save.mutate()} lines={lines} busy={save.isPending} />
    </Card>
  );
}

function RoutinesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'routine-works'], queryFn: () => api.get<RoutineWork[]>('/settings/routine-works') });
  const { draft, setDraft, changes, update, reset } = useDraft(q.data);
  const [summary, setSummary] = useState(false);
  const [adding, setAdding] = useState({ open: false, name: '', nameRu: '' });
  const activeCount = draft.filter((d) => d.active).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'routine-works'] });
  const onErr = (e: unknown) =>
    toast.error(e instanceof ApiError && e.code === 'ROUTINE_LIMIT' ? t('settings.routineLimit', { max: MAX_ROUTINES }) : errorText(e, t));

  const add = useMutation({
    mutationFn: () => api.post('/settings/routine-works', { name: adding.name, nameRu: adding.nameRu || undefined }),
    onSuccess: () => {
      setAdding({ open: false, name: '', nameRu: '' });
      toast.success(t('settings.routineAdded'));
      void refresh();
    },
    onError: onErr,
  });
  const orderChanged = JSON.stringify(draft.map((d) => d.id)) !== JSON.stringify(q.data?.map((d) => d.id));
  const save = useMutation({
    mutationFn: async () => {
      // Avval faolsizlantirish (limitdan joy bo'shasin), keyin qolganlari
      const sorted = [...changes].sort((a) => (a.row.active ? 1 : -1));
      for (const c of sorted) {
        const body: Record<string, unknown> = {};
        for (const f of c.fields) if (f !== 'sortOrder') body[f as string] = c.row[f];
        if (Object.keys(body).length) await api.patch(`/settings/routine-works/${c.row.id}`, body);
      }
      if (orderChanged) await api.put('/settings/routine-works/order', { ids: draft.map((d) => d.id) });
    },
    onSuccess: () => {
      setSummary(false);
      toast.success(t('common.saved'));
      void refresh();
    },
    onError: (e) => {
      onErr(e);
      void refresh();
    },
  });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next.map((d, idx) => ({ ...d, sortOrder: idx + 1 })));
  };
  const lines = [
    ...changes.flatMap((c) =>
      c.fields.filter((f) => f !== 'sortOrder').map((f) => `${c.before.name}: ${t(`settings.field.${String(f)}`)} — ${fmtVal(c.before[f], t)} → ${fmtVal(c.row[f], t)}`),
    ),
    ...(orderChanged ? [t('settings.orderChanged')] : []),
  ];

  return (
    <Card>
      <CardHeader
        title={`${t('settings.routineWorks')} (${activeCount}/${MAX_ROUTINES})`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => (activeCount >= MAX_ROUTINES ? onErr(new ApiError(409, 'ROUTINE_LIMIT', '')) : setAdding({ ...adding, open: true }))}>
              <Plus className="h-4 w-4" /> {t('settings.addRoutine')}
            </Button>
            <Button variant="outline" size="sm" disabled={!lines.length} onClick={reset}>{t('common.reset')}</Button>
            <Button size="sm" disabled={!lines.length} onClick={() => setSummary(true)}>{t('common.save')}</Button>
          </>
        }
      />
      <QueryState q={q}>
        {!draft.length && <Empty />}
        <ul className="divide-y">
          {draft.map((w, i) => (
            <li key={w.id} className={cn('flex flex-wrap items-center gap-2 px-4 py-2 text-sm', !w.active && 'opacity-50', changes.some((c) => c.row.id === w.id) && 'bg-amber-50')}>
              <span className="w-6 text-xs text-gray-400">{i + 1}</span>
              <Input className="h-8 min-w-[200px] flex-1" value={w.name} onChange={(e) => update(w.id, { name: e.target.value })} aria-label={t('common.name')} />
              <Input className="h-8 min-w-[160px] flex-1" value={w.nameRu} onChange={(e) => update(w.id, { nameRu: e.target.value })} aria-label={t('common.nameRu')} />
              {w.reportTypeId && <span className="text-xs text-gray-500">{t('settings.linkedReport')}</span>}
              {w.isFreeText && <span className="text-xs text-gray-500">{t('settings.freeText')}</span>}
              {w.effectiveFrom > new Date().toISOString().slice(0, 10) && <span className="text-xs text-blue-700">{t('settings.fromDate', { date: fmtDate(w.effectiveFrom) })}</span>}
              <Button variant="ghost" size="icon" onClick={() => move(i, -1)} aria-label={t('settings.moveUp')}><ArrowUp className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => move(i, 1)} aria-label={t('settings.moveDown')}><ArrowDown className="h-4 w-4" /></Button>
              <Checkbox
                label={t('settings.field.active')}
                checked={w.active}
                onChange={(v) => {
                  if (v && activeCount >= MAX_ROUTINES) return onErr(new ApiError(409, 'ROUTINE_LIMIT', ''));
                  update(w.id, { active: v });
                }}
              />
            </li>
          ))}
        </ul>
        <p className="px-4 py-3 text-xs text-gray-500">{t('settings.routinesHint')}</p>
      </QueryState>
      <Summary open={summary} onClose={() => setSummary(false)} onConfirm={() => save.mutate()} lines={lines} busy={save.isPending} />
      <Dialog
        open={adding.open}
        onClose={() => setAdding({ ...adding, open: false })}
        title={t('settings.addRoutine')}
        footer={<Button disabled={!adding.name.trim() || add.isPending} onClick={() => add.mutate()}>{t('common.add')}</Button>}
      >
        <div className="space-y-3">
          <Field label={t('common.name')}><Input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></Field>
          <Field label={t('common.nameRu')}><Input value={adding.nameRu} onChange={(e) => setAdding({ ...adding, nameRu: e.target.value })} /></Field>
          <p className="text-xs text-gray-500">{t('settings.nextMonthHint')}</p>
        </div>
      </Dialog>
    </Card>
  );
}

function TemplatesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'templates'], queryFn: () => api.get<UrgentTemplate[]>('/settings/urgent-templates') });
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'templates'] });
  const onErr = (e: unknown) => toast.error(errorText(e, t));
  const add = useMutation({ mutationFn: () => api.post('/settings/urgent-templates', { text }), onSuccess: () => { setText(''); void refresh(); }, onError: onErr });
  const upd = useMutation({ mutationFn: (p: { id: string; text: string }) => api.patch(`/settings/urgent-templates/${p.id}`, { text: p.text }), onSuccess: () => { toast.success(t('common.saved')); void refresh(); }, onError: onErr });
  const [removing, setRemoving] = useState<UrgentTemplate | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.del(`/settings/urgent-templates/${id}`), onSuccess: () => { setRemoving(null); void refresh(); }, onError: onErr });
  return (
    <Card>
      <CardHeader title={t('settings.templates')} />
      <QueryState q={q}>
        {!q.data?.length && <Empty />}
        <ul className="divide-y">
          {q.data?.map((tpl) => (
            <li key={tpl.id} className="flex items-center gap-2 px-4 py-2">
              <Input value={edit[tpl.id] ?? tpl.text} onChange={(e) => setEdit({ ...edit, [tpl.id]: e.target.value })} aria-label={t('settings.templateText')} />
              <Button size="sm" variant="outline" disabled={(edit[tpl.id] ?? tpl.text) === tpl.text} onClick={() => upd.mutate({ id: tpl.id, text: edit[tpl.id] })}>{t('common.save')}</Button>
              <Button size="icon" variant="ghost" onClick={() => setRemoving(tpl)} aria-label={t('common.delete')}><Trash2 className="h-4 w-4 text-red-600" /></Button>
            </li>
          ))}
        </ul>
        <form className="flex gap-2 border-t p-4" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('settings.newTemplate')} />
          <Button type="submit" disabled={!text.trim()}><Plus className="h-4 w-4" /> {t('common.add')}</Button>
        </form>
      </QueryState>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && del.mutate(removing.id)}
        loading={del.isPending}
        text={removing?.text}
      />
    </Card>
  );
}

function GeneralTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'general'], queryFn: () => api.get<{ taskDueTime: string; accountantSharePercent: number }>('/settings/general') });
  const [time, setTime] = useState('');
  const [pct, setPct] = useState('');
  useEffect(() => {
    setTime(q.data?.taskDueTime ?? '');
    setPct(q.data ? String(q.data.accountantSharePercent) : '');
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: { taskDueTime?: string; accountantSharePercent?: number }) => api.put('/settings/general', body),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['settings', 'general'] });
      void qc.invalidateQueries({ queryKey: ['works'] });
    },
    onError: (e) => toast.error(errorText(e, t)),
  });
  const genDry = useMutation({ mutationFn: () => api.post<any>('/generator/run?dryRun=true'), onError: (e) => toast.error(errorText(e, t)) });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('settings.general')} />
        <div className="flex items-end gap-3 p-4">
          <Field label={t('settings.dueTime')} hint={t('settings.dueTimeHint')}><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Button disabled={!time || time === q.data?.taskDueTime} onClick={() => save.mutate({ taskDueTime: time })}>{t('common.save')}</Button>
        </div>
        <div className="flex items-end gap-3 border-t p-4">
          <Field label={t('settings.sharePercent')} hint={t('settings.sharePercentHint')}>
            <Input inputMode="decimal" className="w-28" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Button
            disabled={pct === '' || Number(pct) > 100 || Number(pct) === q.data?.accountantSharePercent}
            onClick={() => save.mutate({ accountantSharePercent: Number(pct) })}
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={t('settings.generator')} actions={<Button size="sm" variant="outline" onClick={() => genDry.mutate()}>{t('settings.generatorDryRun')}</Button>} />
        <div className="p-4 text-sm">
          <p className="text-gray-600">{t('settings.generatorHint')}</p>
          {genDry.data && (
            <p className="mt-2">{t('settings.generatorResult', { created: genDry.data.created, reports: genDry.data.reports, routines: genDry.data.routines, reopened: genDry.data.reopened })}</p>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('reports');
  const tabs: Tab[] = ['reports', 'routines', 'templates', 'general'];
  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <div className="section-container mb-2 flex flex-wrap gap-1 py-1.5" role="tablist">
        {tabs.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={cn('relative cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition-colors', tab === x ? 'border-button text-brand' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900')}>
            {t(`settings.tab.${x}`)}
          </button>
        ))}
      </div>
      {tab === 'reports' && <ReportTypesTab />}
      {tab === 'routines' && <RoutinesTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'general' && <GeneralTab />}
    </div>
  );
}
