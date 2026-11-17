import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps, MouseEvent } from 'react'
import { cn } from '../../lib/utils.js'

// The presses (module/theme.css's scale): `default` is the primary, solid, one a view at most;
// `secondary` a card's white under a hairline, for every other press; `ghost` a toolbar's, a row's own, an icon's;
// `outline` what holds a value; `destructive` solid, in a confirmation; `link` text that goes
// somewhere. Hover raises the contrast a step, a press two, and a pressed button gives way a little
// (to 97%, quick and easing out), unless motion is turned down.
const buttonVariants = cva(
  'focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] ease-out motion-safe:active:not-disabled:scale-97 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        secondary: 'bg-card text-foreground shadow-sm ring-1 ring-hairline ring-inset hover:bg-accent active:bg-foreground/10',
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
        // A bar's icon press: 28 square, and on a phone a finger's 44 around it.
        'icon-bar': 'relative size-7 max-md:after:absolute max-md:after:-inset-2',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Its press is under way: it keeps the keyboard, takes no second press and is drawn dimmed; its words are the caller's. Never `disabled`, which would drop the keyboard to the page. */
  loading?: boolean | undefined
}

/** A press under way: still the keyboard's, refusing presses. */
const WAITING = { 'aria-disabled': true, 'aria-busy': true, onClick: (event: MouseEvent) => event.preventDefault() } as const

export function Button({ className, variant, size, loading = false, ...props }: ButtonProps) {
  // Its variant is said on it, so a row of presses can line a quiet one's words up with its edge.
  return <button data-variant={variant ?? 'default'} className={cn(buttonVariants({ variant, size }), loading && 'cursor-progress opacity-50', className)} {...props} {...(loading && WAITING)} />
}

export { buttonVariants }
