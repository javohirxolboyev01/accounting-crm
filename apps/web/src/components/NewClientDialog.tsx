import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAccountants } from '@/hooks/tasks';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import type { ClientCard, ClientStatus, TaxType } from '@/lib/types';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { DatePicker } from './ui/date-picker';
import { Field, Input, Textarea } from './ui/input';
import { Select } from './ui/select';

const empty = { stir: '', name: '', contactPerson: '', phone: '', taxType: 'AOS' as TaxType, taxTypeEffectiveFrom: '', accountantId: '', status: 'ACTIVE' as ClientStatus, note: '' };

/** Yangi mijoz (faqat rahbar): alohida sahifa emas, mijozlar ro'yxati ustidagi modal. Yaratilgach mijoz kartasiga o'tadi. */
export function NewClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const accountants = useAccountants();
  const [form, setForm] = useState(empty);
  const set = (patch: Partial<typeof empty>) => setForm({ ...form, ...patch });

  useEffect(() => {
    if (open) setForm(empty);
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api.post<ClientCard>('/clients', {
        stir: form.stir,
        name: form.name,
        contactPerson: form.contactPerson || null,
        phone: form.phone || null,
        taxType: form.taxType,
        accountantId: form.accountantId ? Number(form.accountantId) : null,
        status: form.status,
        note: form.note || null,
        ...(form.taxTypeEffectiveFrom && { taxTypeEffectiveFrom: form.taxTypeEffectiveFrom }),
      }),
    onSuccess: (c) => {
      toast.success(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['clients'] });
      onClose();
      navigate(`/clients/${c.id}`);
    },
    onError: (e) => toast.error(errorText(e, t)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('clients.new')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="new-client" disabled={create.isPending}>{t('common.create')}</Button>
        </>
      }
    >
      <form
        id="new-client"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label={t('clients.stir')} htmlFor="nc-stir"><Input id="nc-stir" required inputMode="numeric" value={form.stir} onChange={(e) => set({ stir: e.target.value })} /></Field>
        <Field label={t('clients.name')} htmlFor="nc-name"><Input id="nc-name" required value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label={t('clients.contact')} htmlFor="nc-contact"><Input id="nc-contact" value={form.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} /></Field>
        <Field label={t('clients.phone')} htmlFor="nc-phone" hint={t('clients.phoneHint')}><Input id="nc-phone" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label={t('clients.taxType')} htmlFor="nc-tax">
          <Select id="nc-tax" value={form.taxType} onChange={(v) => set({ taxType: v as TaxType })} options={[{ value: 'AOS', label: 'AOS' }, { value: 'QQS', label: 'QQS' }]} />
        </Field>
        <Field label={t('clients.effectiveFrom')} htmlFor="nc-eff" hint={t('clients.effectiveFromHint')}>
          <DatePicker id="nc-eff" value={form.taxTypeEffectiveFrom} onChange={(v) => set({ taxTypeEffectiveFrom: v })} />
        </Field>
        <Field label={t('clients.accountant')} htmlFor="nc-acc">
          <Select
            id="nc-acc"
            value={form.accountantId}
            onChange={(v) => set({ accountantId: v })}
            placeholder={t('clients.noAccountant')}
            clearable
            options={accountants.data?.map((a) => ({ value: String(a.id), label: `${a.fullName} (${t('urgent.load', { count: a.openCount })})` })) ?? []}
          />
        </Field>
        <Field label={t('clients.status')} htmlFor="nc-status">
          <Select id="nc-status" value={form.status} onChange={(v) => set({ status: v as ClientStatus })} options={(['ACTIVE', 'ZERO_REPORT', 'LIQUIDATING'] as const).map((s) => ({ value: s, label: t(`clientStatus.${s}`) }))} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('clients.note')} htmlFor="nc-note"><Textarea id="nc-note" value={form.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        </div>
      </form>
    </Dialog>
  );
}
