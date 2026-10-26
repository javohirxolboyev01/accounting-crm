import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

// WinPro input uslubi (my-winpro-admin/src/components/ui/input.tsx): teal chegara, fokusda 3px teal halqa
const base = cn(
  'w-full min-w-0 rounded-lg border border-brand-500 bg-white/80 px-3 text-sm shadow-sm outline-none transition-[color,box-shadow,border-color]',
  'selection:bg-brand-500 selection:text-on-brand placeholder:text-gray-500 dark:border-brand-800',
  'focus-visible:border-brand-500 focus-visible:ring-[3px] focus-visible:ring-brand-500/20 focus-visible:ring-offset-0 dark:focus-visible:border-brand-400 dark:focus-visible:ring-brand-400/30',
  'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500/20',
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(base, 'h-10', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn(base, 'min-h-20 py-2', className)} {...p} />,
);
Textarea.displayName = 'Textarea';

const labelCls = 'mb-1 ml-1.5 block text-sm font-medium text-gray-700';

export function Label({ children, htmlFor, className }: { children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn(labelCls, className)}>
      {children}
    </label>
  );
}

/**
 * Yorliq + maydon. htmlFor berilmasa yorliq maydonni o'raydi (bog'lanish avtomatik).
 * group: bir nechta boshqaruv elementi (radio ro'yxati, qidiruv + natijalar) — fieldset/legend.
 */
export function Field({
  label,
  htmlFor,
  children,
  hint,
  group,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
  group?: boolean;
}) {
  const hintEl = hint && <p className="ml-1.5 mt-1 text-xs text-gray-500">{hint}</p>;
  if (group) {
    return (
      <fieldset>
        <legend className={labelCls}>{label}</legend>
        {children}
        {hintEl}
      </fieldset>
    );
  }
  if (htmlFor) {
    return (
      <div>
        <Label htmlFor={htmlFor}>{label}</Label>
        {children}
        {hintEl}
      </div>
    );
  }
  return (
    <div>
      <label className="block">
        <span className={labelCls}>{label}</span>
        {children}
      </label>
      {hintEl}
    </div>
  );
}

/** WinPro checkbox: 20px kvadrat, belgilanganda teal fon + oq belgi */
export function Checkbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('group inline-flex cursor-pointer items-center gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="relative h-5 w-5 shrink-0">
        <input
          type="checkbox"
          className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-gray-300 bg-white checked:border-transparent checked:bg-brand-500 disabled:cursor-not-allowed"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <svg
          className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 peer-checked:block"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
        >
          <path d="M11.6666 3.5L5.24992 9.91667L2.33325 7" stroke="#ffffff" strokeWidth="1.94437" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-sm font-medium text-gray-800">{label}</span>
    </label>
  );
}
