'use client'
import type { ComponentProps } from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { MENU_SURFACE_CLASS } from './dropdown-menu.js'
import { usePopupPlacement } from './popup-placement.js'

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

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'focus-ring inline-flex h-8 min-w-0 max-w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm transition-colors hover:border-input-hover',
        'hover:bg-accent hover:text-accent-foreground active:bg-foreground/10',
        'data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
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
  const positionMethod = usePopupPlacement()
  return (
    <SelectPrimitive.Portal>
      {/* Under the trigger like a menu, not laid over it: the picked item stays readable while the list is open. */}
      <SelectPrimitive.Positioner positionMethod={positionMethod} sideOffset={sideOffset} align={align} alignItemWithTrigger={false} className="z-50 outline-none">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'max-h-[min(var(--available-height),20rem)] min-w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-y-auto p-1.5',
            MENU_SURFACE_CLASS,
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
        'relative flex cursor-pointer select-none items-center rounded-lg py-1.5 pl-2 pr-8 text-sm font-medium outline-none',
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
