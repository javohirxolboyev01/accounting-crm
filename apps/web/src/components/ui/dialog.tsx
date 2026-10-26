import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      data-close
      type="button"
      onClick={onClick}
      aria-label={label}
      className="absolute right-4 top-4 z-20 cursor-pointer rounded-md text-gray-500 transition-all hover:text-gray-700 active:scale-90"
    >
      <X className="h-6 w-6" strokeWidth={2} />
    </button>
  );
}

/** Modal oyna (WinPro Modal ko'rinishi): Esc bilan yopiladi, fokus ichkarida boshlanadi */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-start justify-center overflow-y-auto bg-black/50 no-scrollbar p-4 sm:items-center" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cn('relative w-full max-w-lg animate-pop-in rounded-lg bg-white p-6', className)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <CloseButton onClick={onClose} label={t('common.close')} />
        <h2 className="mb-4 pr-8 text-lg font-semibold text-foreground">{title}</h2>
        <div className="no-scrollbar -mx-1 max-h-[70vh] overflow-y-auto px-1">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

/** O'ng tomondan chiqadigan panel (vazifa tafsilotlari) */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in justify-end bg-black/50" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        className="flex h-full w-full max-w-[380px] animate-slide-in flex-col bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Bildirishnomalar paneli bilan bir xil sarlavha: chapda yumaloq yopish tugmasi */}
        <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900 active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{title}</h2>
        </header>
        <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </aside>
    </div>
  );
}
