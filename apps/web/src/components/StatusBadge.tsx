import { useTranslation } from 'react-i18next';
import { Badge } from './ui/card';
import type { ClientStatus, TaskStatus, TaxType } from '@/lib/types';

const taskCls: Record<TaskStatus, string> = {
  TODO: 'border-gray-300 bg-gray-50 text-gray-700',
  IN_PROGRESS: 'border-blue-300 bg-blue-50 text-blue-700',
  WAITING_CLIENT: 'border-waiting-border bg-waiting-bg text-waiting',
  DONE: 'border-done-border bg-done-bg text-done',
  CANCELLED: 'border-gray-200 bg-gray-100 text-gray-400 line-through',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  return <Badge className={taskCls[status]}>{t(`taskStatus.${status}`)}</Badge>;
}

const clientCls: Record<ClientStatus, string> = {
  ACTIVE: 'border-green-200 bg-green-50 text-green-700',
  ZERO_REPORT: 'border-gray-300 bg-gray-50 text-gray-600',
  LIQUIDATING: 'border-red-200 bg-red-50 text-red-700',
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  const { t } = useTranslation();
  return <Badge className={clientCls[status]}>{t(`clientStatus.${status}`)}</Badge>;
}

export function TaxBadge({ taxType }: { taxType: TaxType }) {
  return (
    <Badge className={taxType === 'QQS' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-teal-200 bg-teal-50 text-teal-700'}>
      {taxType}
    </Badge>
  );
}
