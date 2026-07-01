import * as React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent-700 text-accent-on hover:bg-accent-600 active:bg-accent-800 border border-transparent',
  secondary:
    'bg-surface-2 text-text-strong hover:bg-gray-200 dark:hover:bg-gray-700 border border-border',
  ghost:
    'bg-transparent text-text hover:bg-surface-2 border border-transparent',
  danger:
    'bg-negative-fg text-white hover:opacity-90 active:opacity-100 border border-transparent',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = 'primary', size = 'md', className = '', ...props }, ref) {
    const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;
    return <button ref={ref} className={classes} {...props} />;
  },
);
