import type { HTMLAttributes, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { inPlace } from '../../lib/in-place.js'

/** The card's surface: white, a step above the page, its hairline and a faint lift. */
export const cardSurface = 'rounded-lg border border-hairline bg-card text-card-foreground shadow-sm'

/** The card: a white surface a step above the page, its hairline and a faint lift, with an optional header. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(cardSurface, className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-4 pt-4', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

/**
 * The way from a part of the Overview to its own page, at its heading's right: the page's name and an
 * arrow. A real link, so it also opens in a new tab; a plain click goes through `onOpen`, the
 * dashboard's own navigation.
 */
export function PageLink({ children, href, onOpen }: { children: ReactNode; href: string; onOpen: () => void }) {
  return (
    <a
      href={href}
      onClick={inPlace(onOpen)}
      className="focus-ring -mr-2 inline-flex items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-foreground/10 md:h-7 max-md:h-11"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </a>
  )
}
