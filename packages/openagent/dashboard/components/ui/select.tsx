'use client'
import type { ComponentProps } from 'react'
import { Select as SelectPrimitive } from '@base-ui-components/react/select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils.js'

// A shadcn-style Select on Base UI, matching the DropdownMenu already here (no Radix pulled in).
// Replaces the bare `<select>` the forms and the Settings rows drew by hand: its list was the
// browser's, so it ignored the theme tokens and opened a light list on the dark canvas.
//
// Give `Select` its `items` (`{ value, label }[]`): the trigger then shows the picked item's
// label, also before the list was ever opened. The list is a `listbox` of `option`s and the
// trigger a `combobox`, named by its `aria-label` or by a `<label htmlFor>` on its `id`.

export const Select = SelectPrimitive.Root

export function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

export function SelectTrigger({ className, size = 'default', children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger> & { size?: 'default' | 'sm' }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'inline-flex min-w-0 max-w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-background text-left text-sm shadow-sm outline-none transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        'data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        size === 'sm' ? 'h-8 px-2' : 'h-9 px-3',
        typeof className === 'string' ? className : undefined,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  sideOffset = 4,
  align = 'start',
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Popup> & { sideOffset?: number; align?: 'start' | 'center' | 'end' }) {
  return (
    <SelectPrimitive.Portal>
      {/* Under the trigger like a menu, not laid over it: the picked item stays readable while the list is open. */}
      <SelectPrimitive.Positioner sideOffset={sideOffset} align={align} alignItemWithTrigger={false} className="z-50 outline-none">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'max-h-[min(var(--available-height),20rem)] min-w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-y-auto rounded-md border border-border bg-card p-1 text-card-foreground shadow-md outline-none',
            typeof className === 'string' ? className : undefined,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        typeof className === 'string' ? className : undefined,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="h-3.5 w-3.5" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}
