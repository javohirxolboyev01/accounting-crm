import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

/**
 * Trigger ostida suzuvchi panel (Select menyusi, kalendar). WinPro'da absolute bo'lgan, bu yerda body'ga portal +
 * fixed pozitsiya: jadval/modal ichidagi overflow kesib qo'ymasin. Pastda joy bo'lmasa tepaga ochiladi.
 * Tashqariga bosish yoki Esc — yopadi (Esc modalni yopmasligi uchun capture bosqichida to'xtatiladi).
 */
export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  className,
  matchWidth,
  align = 'start',
}: {
  anchorRef: RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Panel kamida trigger kengligida bo'lsin (Select) */
  matchWidth?: boolean;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const update = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      if (matchWidth) el.style.minWidth = `${a.width}px`;
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      const below = window.innerHeight - a.bottom;
      const top = below < h + 8 && a.top > below ? a.top - h - 4 : a.bottom + 4;
      const left = align === 'end' ? a.right - w : a.left;
      el.style.top = `${Math.max(4, top)}px`;
      el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
      el.style.visibility = 'visible';
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, matchWidth, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchorRef.current?.contains(target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
      anchorRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
      className={cn('z-[70] animate-fade-in rounded-md border border-gray-200 bg-white shadow-lg', className)}
    >
      {children}
    </div>,
    document.body,
  );
}
