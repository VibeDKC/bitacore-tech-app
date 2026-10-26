import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'dark'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[0_10px_24px_-12px_rgba(108,92,231,0.75)] hover:from-brand-500 hover:to-brand-700 active:from-brand-600 active:to-brand-700',
  secondary:
    'border border-line bg-white text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-slate-300 hover:bg-slate-50',
  outline: 'border border-slate-200 bg-transparent text-slate-700 hover:border-slate-300 hover:bg-white',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100/80 hover:text-ink',
  danger:
    'bg-gradient-to-b from-danger-500 to-danger-600 text-white shadow-[0_10px_24px_-12px_rgba(240,68,56,0.65)] hover:to-danger-700',
  success:
    'bg-gradient-to-b from-success-500 to-success-600 text-white shadow-[0_10px_24px_-12px_rgba(18,183,106,0.6)] hover:to-success-700',
  dark: 'bg-ink text-white shadow-[0_10px_24px_-14px_rgba(16,24,40,0.8)] hover:bg-slate-800'
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm font-semibold',
  lg: 'h-12 gap-2.5 rounded-xl px-5 text-sm font-semibold',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg'
}

export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}) {
  return cn(
    'inline-flex select-none items-center justify-center whitespace-nowrap transition-all duration-150 focus-ring disabled:pointer-events-none disabled:opacity-45',
    variants[variant],
    sizes[size],
    className
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, leftIcon, rightIcon, children, disabled, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={buttonStyles({ variant, size, className })}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
      {children}
      {rightIcon}
    </button>
  )
})
