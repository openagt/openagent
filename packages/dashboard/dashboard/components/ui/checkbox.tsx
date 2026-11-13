'use client'
import type { ComponentProps } from 'react'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils.js'

// A shadcn-style Checkbox on Base UI, matching the Tooltip and DropdownMenu already here (no Radix
// pulled in). Replaces the bare `<input type="checkbox">` every panel used to hand-roll: those got
// their look from the browser, so they ignored the theme tokens, skipped the focus ring the rest of
// the app uses, and drew a light box on the dark canvas.
// `disabled` is widened to accept undefined: under `exactOptionalPropertyTypes` the primitive's
// `disabled?: boolean` rejects it, and callers pass expressions like `busy || transparent` that are
// naturally `boolean | undefined`. Normalising here beats a `!!` at every call site.
type CheckboxProps = Omit<ComponentProps<typeof CheckboxPrimitive.Root>, 'disabled'> & {
  disabled?: boolean | undefined
}

export function Checkbox({ className, disabled = false, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      disabled={disabled}
      className={cn(
        // A 16px mark in a 24px hit area.
        'focus-ring relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border bg-transparent after:absolute after:-inset-1 hover:not-data-[checked]:border-faint-foreground',
        'transition-colors data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground data-[checked]:hover:bg-primary/90',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[readonly]:pointer-events-none',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
