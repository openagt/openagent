'use client'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { cn } from '../../lib/utils.js'

// A shadcn-style RadioGroup on Base UI, beside the Checkbox and the Switch: for one pick among a
// few that all stay in view. Replaces the bare `<input type="radio">` the forms drew by hand,
// which took its look from the browser and ignored the theme. An item is the dot alone: put it in
// a `<label>` with its words, so a click on the words picks it. `disabled` is widened as on the
// Checkbox; a `<fieldset disabled>` around the group does not reach it, so pass it here. A field
// may sit inside the group beside a radio (a number to type): it keeps its own keys.
type RadioGroupProps = Omit<ComponentProps<typeof RadioGroupPrimitive>, 'disabled'> & {
  disabled?: boolean | undefined
}

export function RadioGroup({ className, disabled = false, onKeyDown, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      disabled={disabled}
      className={cn('grid gap-2', className)}
      // The group moves the pick with the arrow keys. A field or a button drawn inside it, beside
      // a radio, keeps its own keys: an arrow in a number field steps the number, and picks nothing.
      onKeyDown={event => {
        if (!(event.target as HTMLElement).closest('[role="radio"]')) event.preventBaseUIHandler()
        onKeyDown?.(event)
      }}
      {...props}
    />
  )
}

type RadioGroupItemProps = Omit<ComponentProps<typeof Radio.Root>, 'disabled'> & {
  disabled?: boolean | undefined
}

export function RadioGroupItem({ className, disabled, ...props }: RadioGroupItemProps) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      {...(disabled !== undefined ? { disabled } : {})}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-transparent',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        'data-[checked]:border-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <Radio.Indicator className="h-2 w-2 rounded-full bg-primary" />
    </Radio.Root>
  )
}

/**
 * A radio with its words: the dot inside a `<label>`, so a click on the words picks it. The label
 * also names the dot for a screen reader, by `aria-labelledby`: Base UI's radio is no form control,
 * so a `<label>` around it alone gives it no name.
 */
export function RadioGroupOption({ value, disabled, className, children }: { value: string; disabled?: boolean | undefined; className?: string; children: ReactNode }) {
  const id = useId()
  return (
    <label id={id} data-slot="radio-group-option" className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-snug has-[[data-disabled]]:opacity-50', className)}>
      <RadioGroupItem value={value} disabled={disabled} aria-labelledby={id} />
      {children}
    </label>
  )
}
