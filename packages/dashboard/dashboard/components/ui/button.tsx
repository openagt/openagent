import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// The presses (module/theme.css's scale): `default` is the primary, solid, one a view at most;
// `secondary` a soft fill, for every other press; `ghost` a toolbar's, a row's own, an icon's;
// `outline` what holds a value; `destructive` solid, in a confirmation; `link` text that goes
// somewhere. Hover raises the contrast a step, a press two.
const buttonVariants = cva(
  'focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        secondary: 'bg-accent text-accent-foreground hover:bg-foreground/10 active:bg-foreground/15',
        outline: 'border border-border bg-transparent hover:bg-accent hover:text-accent-foreground active:bg-foreground/10',
        ghost: 'hover:bg-accent hover:text-accent-foreground active:bg-foreground/10',
        // A confirmed destructive action (#1032): --danger is a fill, so its label inverts the
        // opposite way (text-background).
        destructive: 'bg-danger text-background hover:bg-danger-hover active:bg-danger-active',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 gap-1.5 px-2',
        default: 'h-8 px-3',
        lg: 'h-9 px-4',
        icon: 'size-8',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Working on the press: the label stays, so the button keeps its width, under a spinner, and it takes no second press. */
  loading?: boolean | undefined
}

export function Button({ className, variant, size, loading = false, disabled, children, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? (
        <span className="relative inline-flex items-center justify-center" style={{ gap: 'inherit' }}>
          <span className="invisible contents">{children}</span>
          <Loader2 className="absolute size-4 animate-spin" aria-hidden />
        </span>
      ) : (
        children
      )}
    </button>
  )
}

export { buttonVariants }
