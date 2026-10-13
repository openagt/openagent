import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'
import { cn } from '../lib/utils.js'

// The Settings page's building blocks (#958): a section, a row, a row picked from a list. The page's
// own sections are made of them, and so is a section a module brings (`@openagt/dashboard/module` exports
// them), so every section of the page looks alike.

/** One section of the Settings page: a titled card of rows. */
export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">{children}</div>
      </CardContent>
    </Card>
  )
}

/** One setting: what it is and what it does on the left, its control on the right. */
export function SettingsRow({
  label,
  description,
  control,
  dimmed = false,
}: {
  label: string
  description: string
  control: ReactNode
  /** A row the rules turned off: greyed, but still shown with its reason. */
  dimmed?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className={cn('text-sm', dimmed && 'text-muted-foreground')}>{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export interface SettingsOption {
  value: string
  label: string
  /** A line in the list that says something rather than being a choice. */
  disabled?: boolean
}

/** What stands in for the empty value in the list: a choice whose value is no text ("Auto-detect", an agent's own default) is still a choice to pick. */
const NO_VALUE = '\u0000none'

/**
 * One setting picked from a list.
 *
 * A row with nothing to pick renders nothing at all (#1172). An empty list is a control that
 * cannot be operated — it reads as broken rather than as "no choices here", which is exactly the
 * paper cut this guard exists for. Every list on this page has a fixed first entry today ("Auto-detect",
 * the agent's own default), so nothing hits it; it is here because the next list will be added
 * without thinking about the empty case.
 */
export function SettingsSelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string
  description: string
  value: string
  options: SettingsOption[]
  onChange: (next: string) => void
}) {
  if (options.length === 0) return null
  const items = options.map(o => ({ value: o.value === '' ? NO_VALUE : o.value, label: o.label, disabled: o.disabled === true }))
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <Select items={items} value={value === '' ? NO_VALUE : value} onValueChange={next => onChange(next === NO_VALUE ? '' : (next as string))}>
          <SelectTrigger size="sm" aria-label={label} className="max-w-[min(16rem,45vw)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {items.map(item => (
              <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}
