'use client'
import type { ComponentProps } from 'react'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '../../lib/utils.js'

// A shadcn-style Switch on Base UI, beside the Checkbox: for a setting that is on or off and takes
// effect at once, where a checkbox reads as one line of a form still to be sent. The track takes
// the primary colour when on; the thumb slides. `disabled` is widened as on the Checkbox.
type SwitchProps = Omit<ComponentProps<typeof SwitchPrimitive.Root>, 'disabled'> & {
  disabled?: boolean | undefined
}

export function Switch({ className, disabled = false, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      disabled={disabled}
      className={cn(
        // A 16px track in a 24px hit area.
        'focus-ring relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-border bg-muted p-0.5 after:absolute after:-inset-y-1 after:inset-x-0 hover:not-data-[checked]:border-faint-foreground',
        'transition-colors data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:hover:bg-primary/90',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-2.5 rounded-full bg-foreground/70 transition-transform data-[checked]:translate-x-3 data-[checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  )
}
