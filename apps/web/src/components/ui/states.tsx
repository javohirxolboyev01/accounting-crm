import { AlertTriangle, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';
import { Spinner } from './spinner';
import { errorText } from '@/lib/errors';

export function Loading({ className = 'py-10' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center justify-center gap-3 text-sm text-gray-500 ${className}`} role="status">
      <Spinner size="small" className="text-brand-500" /> {t('common.loading')}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-sm text-red-700" role="alert">
      <AlertTriangle className="h-5 w-5" />
      <span>{errorText(error, t)}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function Empty({ text }: { text?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 p-4 py-10 text-center text-sm font-medium text-gray-500">
      <Inbox className="h-5 w-5" />
      {text ?? t('common.empty')}
    </div>
  );
}

/** useQuery natijasi uchun umumiy holatlar */
export function QueryState({ q, children }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown }; children: React.ReactNode }) {
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <>{children}</>;
}
