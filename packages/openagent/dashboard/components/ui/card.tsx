import { useContext, type HTMLAttributes, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../../lib/host-services.js'

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
 * A card's title that opens the card's own page, named by its `segment`. A card on the Overview
 * is a summary: its title is the way to the whole. A real link, so it also opens in a new tab,
 * with the project the dashboard is showing; a plain click goes through `onOpen`, the dashboard's
 * own navigation. The arrow shows on hover and focus, and always on a
 * phone, where nothing hovers.
 */
export function CardTitleLink({ icon, children, segment, onOpen, className }: { icon?: ReactNode; children: ReactNode; /** The page the title opens, by its segment. */ segment: string; onOpen: () => void; className?: string }) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  return (
    <CardTitle className={cn('text-base', className)}>
      <a
        href={services.pageHref(segment)}
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
