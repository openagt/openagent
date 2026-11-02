import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// A trimmed shadcn Table: a real `<table>` with the page's own lines and type, so a list with
// columns looks the same wherever one is drawn. A row that opens something takes its own
// `onClick` and `cursor-pointer`; the hover fill is here for every row.

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom text-left text-sm', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('text-xs text-muted-foreground [&_tr]:border-b [&_tr]:border-border [&_tr:hover]:bg-transparent', className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn('border-b border-border transition-colors hover:bg-accent/60', className)} {...props} />
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return <th data-slot="table-head" className={cn('h-9 whitespace-nowrap px-3 text-left align-middle font-normal first:pl-0 last:pr-0', className)} {...props} />
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-3 py-2 align-middle first:pl-0 last:pr-0', className)} {...props} />
}
