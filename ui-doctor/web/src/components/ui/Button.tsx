import { clsx } from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-2 active:translate-y-px disabled:opacity-50',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2 active:translate-y-px disabled:opacity-50',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2 disabled:opacity-40',
  danger: 'bg-surface text-critical border border-line hover:border-critical/40 hover:bg-critical/5 disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 select-none',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 18 : 14} /> : icon}
      {children}
    </button>
  );
});
