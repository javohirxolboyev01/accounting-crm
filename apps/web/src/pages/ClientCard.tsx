import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { TaskStatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Empty, QueryState } from '@/components/ui/states';
import { FormSkeleton, ListSkeleton } from '@/components/ui/skeleton';
import { invalidateTasks, taskTitle, taskTone, useAccountants } from '@/hooks/tasks';
import { useOpenTask } from '@/hooks/outlet';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { errorText } from '@/lib/errors';
import { currentMonth, fmtDate, fmtDateTime, fmtShortDue, quarterOfPrevMonth } from '@/lib/time';
import type { AuditItem, ClientCard as ClientCardData, ClientStatus, Task, TaxType } from '@/lib/types';

interface Form {
  stir: string;
  name: string;
  contactPerson: string;
  phone: string;
  taxType: TaxType;
  taxTypeEffectiveFrom: string;
  accountantId: string;
  status: ClientStatus;
  note: string;
}

const empty: Form = { stir: '', name: '', contactPerson: '', phone: '', taxType: 'AOS', taxTypeEffectiveFrom: '', accountantId: '', status: 'ACTIVE', note: '' };

function toForm(c: ClientCardData): Form {
  return {
    stir: c.stir,
    name: c.name,
    contactPerson: c.contactPerson ?? '',
    phone: c.phone ?? '',
    taxType: c.taxType,
    taxTypeEffectiveFrom: c.taxTypeEffectiveFrom ?? '',
    accountantId: c.accountantId ? String(c.accountantId) : '',
    status: c.status,
    note: c.note ?? '',
  };
}

export default function ClientCard() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { isLeader } = useAuth();
  const qc = useQueryClient();
  const openTask = useOpenTask();
  const accountants = useAccountants();
  const [form, setForm] = useState<Form>(empty);
  const [confirmTax, setConfirmTax] = useState(false);
  const [quarter, setQuarter] = useState(quarterOfPrevMonth());

  const q = useQuery({ queryKey: ['client', id], queryFn: () => api.get<ClientCardData>(`/clients/${id}`) });
  const history = useQuery({ queryKey: ['client', id, 'history'], queryFn: () => api.get<AuditItem[]>(`/clients/${id}/history`) });
  const tasks = useQuery({ queryKey: ['tasks', 'client', id], queryFn: () => api.get<Task[]>(`/tasks${qs({ clientId: id, month: currentMonth() })}`) });
  useEffect(() => {
    if (q.data) setForm(toForm(q.data));
  }, [q.data]);

  const onErr = (e: unknown) => toast.error(errorText(e, t));
  const refresh = () => {
    invalidateTasks(qc);
    void qc.invalidateQueries({ queryKey: ['client', id] });
  };

  const payload = () => {
    const body: Record<string, unknown> = {
      contactPerson: form.contactPerson || null,
      phone: form.phone || null,
      note: form.note || null,
    };
    if (isLeader) {
      Object.assign(body, {
        stir: form.stir,
        name: form.name,
        taxType: form.taxType,
        accountantId: form.accountantId ? Number(form.accountantId) : null,
        status: form.status,
      });
      if (form.taxTypeEffectiveFrom && form.taxTypeEffectiveFrom !== q.data?.taxTypeEffectiveFrom) body.taxTypeEffectiveFrom = form.taxTypeEffectiveFrom;
    }
    return body;
  };

  const save = useMutation({
    mutationFn: () => api.patch<ClientCardData>(`/clients/${id}`, payload()),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setConfirmTax(false);
      refresh();
    },
    onError: onErr,
  });
  const dividend = useMutation({
    mutationFn: (p: { quarter: string; on: boolean }) =>
      p.on ? api.put(`/clients/${id}/dividend/${p.quarter}`) : api.del(`/clients/${id}/dividend/${p.quarter}`),
    onSuccess: refresh,
    onError: onErr,
  });

  const taxChanged = q.data && (form.taxType !== q.data.taxType || (form.taxTypeEffectiveFrom || '') !== (q.data.taxTypeEffectiveFrom ?? ''));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (taxChanged) setConfirmTax(true);
    else save.mutate();
  };
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const ro = !isLeader; // buxgalter: faqat aloqa va izoh

  const content = (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader title={t('clients.card')} />
        <form onSubmit={submit} className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label={t('clients.stir')} htmlFor="stir"><Input id="stir" required inputMode="numeric" value={form.stir} disabled={ro} onChange={(e) => set({ stir: e.target.value })} /></Field>
          <Field label={t('clients.name')} htmlFor="name"><Input id="name" required value={form.name} disabled={ro} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label={t('clients.contact')} htmlFor="contact"><Input id="contact" value={form.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} /></Field>
          <Field label={t('clients.phone')} htmlFor="phone" hint={t('clients.phoneHint')}><Input id="phone" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label={t('clients.taxType')} htmlFor="tax" hint={ro ? t('clients.taxLeaderOnly') : undefined}>
            <Select id="tax" value={form.taxType} disabled={ro} onChange={(v) => set({ taxType: v as TaxType })} options={[{ value: 'AOS', label: 'AOS' }, { value: 'QQS', label: 'QQS' }]} />
          </Field>
          <Field label={t('clients.effectiveFrom')} htmlFor="eff" hint={t('clients.effectiveFromHint')}>
            <DatePicker id="eff" value={form.taxTypeEffectiveFrom} disabled={ro} onChange={(v) => set({ taxTypeEffectiveFrom: v })} />
          </Field>
          <Field label={t('clients.accountant')} htmlFor="acc">
            <Select
              id="acc"
              value={form.accountantId}
              disabled={ro}
              onChange={(v) => set({ accountantId: v })}
              placeholder={t('clients.noAccountant')}
              clearable
              options={accountants.data?.map((a) => ({ value: String(a.id), label: `${a.fullName} (${t('urgent.load', { count: a.openCount })})` })) ?? []}
            />
          </Field>
          <Field label={t('clients.status')} htmlFor="status">
            <Select id="status" value={form.status} disabled={ro} onChange={(v) => set({ status: v as ClientStatus })} options={(['ACTIVE', 'ZERO_REPORT', 'LIQUIDATING'] as const).map((s) => ({ value: s, label: t(`clientStatus.${s}`) }))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('clients.note')} htmlFor="note"><Textarea id="note" value={form.note} onChange={(e) => set({ note: e.target.value })} /></Field>
          </div>
          {q.data && form.accountantId !== String(q.data.accountantId ?? '') && (
            <p className="text-xs text-amber-700 sm:col-span-2">{t('clients.reassignHint')}</p>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>{t('common.save')}</Button>
          </div>
        </form>
      </Card>

      {q.data && (
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('clients.taxHistory')} />
            {!q.data.taxHistory?.length && <Empty />}
            <ul className="divide-y text-sm">
              {q.data.taxHistory?.map((h) => (
                <li key={h.id} className="flex justify-between px-4 py-2">
                  <span><b>{h.taxType}</b> · {h.effectiveFrom === '2000-01-01' ? t('clients.fromStart') : `${fmtDate(h.effectiveFrom)} ${t('clients.since')}`}</span>
                  <span className="text-xs text-gray-500">{h.createdByName ?? t('notif.system')}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title={t('clients.dividend')} />
            <div className="space-y-3 p-4 text-sm">
              <p className="text-xs text-gray-500">{t('clients.dividendHint')}</p>
              <div className="flex gap-2">
                <Input value={quarter} onChange={(e) => setQuarter(e.target.value.toUpperCase())} placeholder="2026-Q3" aria-label={t('clients.dividendQuarter')} />
                <Button variant="outline" disabled={!/^\d{4}-Q[1-4]$/.test(quarter)} onClick={() => dividend.mutate({ quarter, on: true })}>{t('clients.markDividend')}</Button>
              </div>
              <ul className="flex flex-wrap gap-2">
                {q.data.dividendQuarters?.map((dq) => (
                  <li key={dq} className="inline-flex items-center gap-1 rounded-full border bg-gray-50 px-2 py-0.5 text-xs">
                    {dq}
                    <button onClick={() => dividend.mutate({ quarter: dq, on: false })} aria-label={t('common.delete')}><Trash2 className="h-3 w-3 text-gray-400 hover:text-red-600" /></button>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      )}
      <Card className="xl:col-span-2">
        <CardHeader title={t('clients.currentTasks')} />
        <QueryState q={tasks}>
          {!tasks.data?.length && <Empty />}
          <ul className="divide-y text-sm">
            {tasks.data?.map((task) => {
              const tone = taskTone(task);
              return (
                <li key={task.id}>
                  <button className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50" onClick={() => openTask(task.id)}>
                    <span className="flex-1">{taskTitle(task, i18n.language)}</span>
                    <span className={cn('text-xs', tone === 'overdue' && 'text-overdue', tone === 'soon' && 'text-soon')}>{fmtShortDue(task.dueAt)}</span>
                    <span className="w-28 truncate text-xs text-gray-500">{task.assigneeName ?? t('task.unassigned')}</span>
                    <TaskStatusBadge status={task.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        </QueryState>
      </Card>

      <Card>
        <CardHeader title={t('clients.history')} />
        <QueryState q={history}>
          {!history.data?.length && <Empty />}
          <ul className="max-h-[500px] divide-y overflow-y-auto text-xs">
            {history.data?.map((h) => (
              <li key={h.id} className="px-4 py-2">
                <div className="flex justify-between text-gray-500"><span>{h.actorName ?? t('notif.system')}</span><span>{fmtDateTime(h.at)}</span></div>
                <div className="mt-0.5"><b>{t(`auditAction.${h.action}`, { defaultValue: h.action })}</b> · {h.entity} #{h.entityId}</div>
                {h.after != null && <code className="mt-0.5 block break-all text-gray-600">{JSON.stringify(h.after)}</code>}
              </li>
            ))}
          </ul>
        </QueryState>
      </Card>
    </div>
  );

  return (
    <div>
      <PageHeader crumbs={[{ to: '/clients', label: t('nav.clients') }]} title={q.data?.name ?? '…'} />
      <QueryState
        q={q}
        skeleton={
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-md bg-white xl:col-span-2"><FormSkeleton fields={9} /></div>
            <div className="space-y-4">
              <div className="rounded-md bg-white"><ListSkeleton rows={2} /></div>
              <div className="rounded-md bg-white"><ListSkeleton rows={2} /></div>
            </div>
          </div>
        }
      >
        {content}
      </QueryState>
      <Dialog
        open={confirmTax}
        onClose={() => setConfirmTax(false)}
        title={t('clients.confirmTaxTitle')}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmTax(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{t('common.confirm')}</Button>
          </>
        }
      >
        <p className="text-sm">{t('clients.confirmTaxBody', { from: q.data?.taxType, to: form.taxType, date: form.taxTypeEffectiveFrom ? fmtDate(form.taxTypeEffectiveFrom) : t('clients.thisMonth') })}</p>
      </Dialog>
    </div>
  );
}
