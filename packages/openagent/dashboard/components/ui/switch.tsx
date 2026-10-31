'use client'
import type { ComponentProps } from 'react'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@openagt/skill-ui/module'

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
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-muted p-0.5',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        'data-[checked]:border-primary data-[checked]:bg-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full bg-foreground/70 transition-transform data-[checked]:translate-x-4 data-[checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  )
}
