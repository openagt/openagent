import type { HTMLAttributes, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '../../lib/utils.js'

// Minimal shadcn-style Card for the dashboard page (#471): a bordered surface with an
// optional header. Just enough structure to keep the page's panels consistent.
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card text-card-foreground', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-4 pt-4', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold', className)} {...props} />
}

/**
 * A card's title that opens the card's own page. A card on the Overview is a summary: its title is
 * the way to the whole. A real link, so it also opens in a new tab; a plain click goes through
 * `onOpen`, the dashboard's own navigation. The arrow shows on hover and focus, and always on a
 * phone, where nothing hovers.
 */
export function CardTitleLink({ icon, children, href, onOpen, className }: { icon?: ReactNode; children: ReactNode; href: string; onOpen: () => void; className?: string }) {
  return (
    <CardTitle className={cn('text-base', className)}>
      <a
        href={href}
        onClick={event => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          onOpen()
        }}
        className="group -mx-1 inline-flex items-center gap-2 rounded px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        {icon}
        {children}
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:opacity-100" aria-hidden />
      </a>
    </CardTitle>
  )
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}
