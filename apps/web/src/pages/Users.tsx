import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { QueryState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/lib/errors';
import { fmtDate } from '@/lib/time';
import type { Lang, Role, User } from '@/lib/types';

type Edit = { id?: number; fullName: string; login: string; password: string; role: Role; language: Lang };
const blank: Edit = { fullName: '', login: '', password: '', role: 'ACCOUNTANT', language: 'uz' };

export default function Users() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [reset, setReset] = useState<{ id: number; name: string; password: string } | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: ['accountants'] });
  };
  const onErr = (e: unknown) => toast.error(errorText(e, t));

  const save = useMutation({
    mutationFn: (e: Edit) =>
      e.id
        ? api.patch(`/users/${e.id}`, { fullName: e.fullName, role: e.role, language: e.language })
        : api.post('/users', { fullName: e.fullName, login: e.login, password: e.password, role: e.role, language: e.language }),
    onSuccess: () => {
      setEdit(null);
      toast.success(t('common.saved'));
      refresh();
    },
    onError: onErr,
  });
  const toggle = useMutation({ mutationFn: (u: User) => api.patch(`/users/${u.id}`, { active: !u.active }), onSuccess: refresh, onError: onErr });
  const resetPw = useMutation({
    mutationFn: (r: { id: number; password: string }) => api.post(`/users/${r.id}/reset-password`, { password: r.password }),
    onSuccess: () => {
      setReset(null);
      toast.success(t('users.passwordReset'));
    },
    onError: onErr,
  });

  return (
    <div>
      <PageHeader title={t('users.title')} actions={<Button onClick={() => setEdit({ ...blank })}><Plus className="h-4 w-4" /> {t('users.new')}</Button>} />
      <Card>
        <QueryState q={q}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-2.5">{t('users.fullName')}</th>
                  <th className="px-4 py-2.5">{t('users.login')}</th>
                  <th className="px-4 py-2.5">{t('users.role')}</th>
                  <th className="px-4 py-2.5">{t('users.language')}</th>
                  <th className="px-4 py-2.5">Telegram</th>
                  <th className="px-4 py-2.5">{t('users.created')}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {q.data?.map((u) => (
                  <tr key={u.id} className={`border-t border-gray-200 transition-colors hover:bg-gray-100 ${u.active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2.5 font-medium">{u.fullName} {!u.active && <Badge className="ml-1 border-gray-300 text-gray-500">{t('common.inactive')}</Badge>}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{u.login}</td>
                    <td className="px-4 py-2.5">{t(`roles.${u.role}`)}</td>
                    <td className="px-4 py-2.5 uppercase">{u.language}</td>
                    <td className="px-4 py-2.5">{u.telegramLinked ? '✓' : '—'}</td>
                    <td className="px-4 py-2.5 text-xs">{fmtDate(u.createdAt)}</td>
                    <td className="space-x-1 whitespace-nowrap px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEdit({ id: u.id, fullName: u.fullName, login: u.login, password: '', role: u.role, language: u.language })}>{t('common.edit')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setReset({ id: u.id, name: u.fullName, password: '' })}>{t('users.resetPassword')}</Button>
                      {u.id !== me?.id && (
                        <Button size="sm" variant="ghost" onClick={() => toggle.mutate(u)}>{u.active ? t('users.deactivate') : t('users.activate')}</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? t('users.edit') : t('users.new')}
        footer={<Button disabled={!edit?.fullName || (!edit.id && (!edit.login || edit.password.length < 8)) || save.isPending} onClick={() => edit && save.mutate(edit)}>{t('common.save')}</Button>}
      >
        {edit && (
          <div className="grid gap-3">
            <Field label={t('users.fullName')}><Input value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></Field>
            <Field label={t('users.login')}><Input value={edit.login} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, login: e.target.value })} /></Field>
            {!edit.id && <Field label={t('users.password')} hint={t('users.passwordHint')}><Input type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>}
            <Field label={t('users.role')}>
              <Select
                value={edit.role}
                disabled={edit.id === me?.id}
                onChange={(v) => setEdit({ ...edit, role: v as Role })}
                options={[
                  { value: 'ACCOUNTANT', label: t('roles.ACCOUNTANT') },
                  { value: 'LEADER', label: t('roles.LEADER') },
                ]}
              />
            </Field>
            <Field label={t('users.language')}>
              <Select value={edit.language} onChange={(v) => setEdit({ ...edit, language: v as Lang })} options={[{ value: 'uz', label: "O'zbekcha" }, { value: 'ru', label: 'Русский' }]} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!reset}
        onClose={() => setReset(null)}
        title={`${t('users.resetPassword')}: ${reset?.name ?? ''}`}
        footer={<Button disabled={(reset?.password.length ?? 0) < 8} onClick={() => reset && resetPw.mutate(reset)}>{t('common.save')}</Button>}
      >
        {reset && (
          <Field label={t('profile.newPassword')} hint={t('users.passwordHint')}>
            <Input type="password" autoComplete="new-password" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} />
          </Field>
        )}
      </Dialog>
    </div>
  );
}
