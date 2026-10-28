import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
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

/** Butun son xonalarga ajratiladi (1,500,000 — jadvaldagi fmtMoney bilan bir xil); holatda faqat raqamlar turadi */
const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function NumberInput({
  value,
  onChange,
  ...p
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: string; onChange: (digits: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  // Formatlashdan keyin kursor joyi: o'ngidagi raqamlar soni saqlanadi (vergul qo'shilsa kursor oxiriga sakramaydi)
  const digitsRight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || digitsRight.current == null) return;
    let pos = el.value.length;
    for (let n = digitsRight.current; n > 0 && pos > 0; pos--) if (/\d/.test(el.value[pos - 1])) n--;
    el.setSelectionRange(pos, pos);
    digitsRight.current = null;
  });
  return (
    <Input
      ref={ref}
      inputMode="numeric"
      autoComplete="off"
      {...p}
      value={groupDigits(value)}
      onChange={(e) => {
        let raw = e.target.value;
        const caret = e.target.selectionStart ?? raw.length;
        digitsRight.current = raw.slice(caret).replace(/\D/g, '').length;
        // Backspace faqat vergulni o'chirgan bo'lsa (raqamlar o'zgarmagan), undan oldingi raqam o'chiriladi
        if (raw.length < groupDigits(value).length && raw.replace(/\D/g, '') === value) {
          const i = raw.slice(0, caret).search(/\d(?=\D*$)/);
          if (i >= 0) raw = raw.slice(0, i) + raw.slice(i + 1);
        }
        onChange(raw.replace(/\D/g, '').replace(/^0+(?=\d)/, ''));
      }}
    />
  );
}

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
