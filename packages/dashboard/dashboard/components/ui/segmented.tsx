'use client'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { cn } from '../../lib/utils.js'

/**
 * One pick among two or three short words that all stay in view, as a track of segments: the picked
 * one a card on the track, as the filter chips draw theirs. A radio group: the arrow keys move the
 * pick, and a screen reader says the group's name and each word.
 */
export function Segmented<T extends string>({ label, value, options, onChange, className }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (next: T) => void; className?: string }) {
  return (
    <RadioGroupPrimitive aria-label={label} value={value} onValueChange={next => onChange(next as T)} className={cn('inline-flex gap-0.5 rounded-lg bg-accent p-0.5', className)}>
      {options.map(option => (
        <Radio.Root
          key={option.value}
          value={option.value}
          className={cn(
            'focus-ring flex h-7 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] max-md:h-10',
            'text-muted-foreground pointer-fine:hover:text-foreground data-[checked]:bg-card data-[checked]:text-foreground data-[checked]:shadow-sm data-[checked]:ring-1 data-[checked]:ring-hairline',
          )}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroupPrimitive>
  )
}
