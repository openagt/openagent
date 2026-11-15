import { createContext, type ComponentType } from 'react'
import { Blocks, Ellipsis, LayoutDashboard, Plus } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { inPlace } from '../lib/in-place.js'
import { useSidebar } from './ui/sidebar.js'

/** Where a page's count is drawn while a {@link PhoneBar} names the page: beside that name. None where no bar is drawn. */
export const PhoneBarCount = createContext<HTMLElement | null>(null)

/**
 * The top row of a page that has none of its own: the page's name and the page's count, which the
 * page draws into `countSlot`. It stays at the top as the page scrolls.
 */
export function PhoneBar({ title, countSlot }: { title: string; countSlot: (slot: HTMLElement | null) => void }) {
  return (
    <div data-phone-bar="" className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4 text-sm font-medium">
      <span className="truncate">{title}</span>
      <span ref={countSlot} className="shrink-0 font-normal tabular-nums text-muted-foreground empty:hidden" />
    </div>
  )
}

/** How many of the modules' pages the bar holds; the others are under More. */
const PAGES_IN_BAR = 2

type BarPage = { segment: string; label: string; icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> | undefined }

/**
 * A phone's bar of pages, at the foot of every page but a session's (whose top bar has a back arrow): the Overview, with how many things wait on the
 * person in amber; the first two of the modules' pages; New, the "New agent session" page; and More,
 * the sidebar as a sheet, which holds the sessions, every page and the person. Each a 56-high press,
 * its icon over its name.
 */
export function PagesBar({
  pages,
  activePage,
  overviewActive,
  overviewHref,
  onOverview,
  pageHref,
  onPage,
  newHref,
  newActive,
  onNew,
  waiting,
}: {
  /** The modules' pages, in the sidebar's order. */
  pages: readonly BarPage[]
  /** The page shown, by its segment, or null. */
  activePage: string | null
  overviewActive: boolean
  overviewHref: string
  onOverview: () => void
  pageHref: (segment: string) => string
  onPage: (segment: string) => void
  /** The "New agent session" page, as the sidebar's New opens it. */
  newHref: string
  newActive: boolean
  onNew: () => void
  /** How many things wait on the person: the Overview's count. */
  waiting: number
}) {
  const { openMobile, setOpenMobile } = useSidebar()
  const item = (active: boolean) =>
    cn('focus-ring-inset relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors', active ? 'font-medium text-foreground' : 'text-muted-foreground active:text-foreground')
  return (
    <nav aria-label="Pages" className="sticky bottom-0 z-20 flex shrink-0 border-t border-hairline bg-background">
      <a href={overviewHref} onClick={inPlace(onOverview)} aria-current={overviewActive ? 'page' : undefined} aria-label={waiting > 0 ? `Overview, ${waiting} waiting on you` : 'Overview'} className={item(overviewActive)}>
        <span className="relative">
          <LayoutDashboard className="size-5" aria-hidden />
          {waiting > 0 && <span aria-hidden className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-xs font-semibold text-card">{waiting}</span>}
        </span>
        <span aria-hidden className="max-w-full truncate px-1">Overview</span>
      </a>
      {pages.slice(0, PAGES_IN_BAR).map(page => {
        const Icon = page.icon ?? Blocks
        const active = activePage === page.segment
        return (
          <a key={page.segment} href={pageHref(page.segment)} onClick={inPlace(() => onPage(page.segment))} aria-current={active ? 'page' : undefined} className={item(active)}>
            <Icon className="size-5" aria-hidden />
            <span className="max-w-full truncate px-1">{page.label}</span>
          </a>
        )
      })}
      <a href={newHref} onClick={inPlace(onNew)} aria-current={newActive ? 'page' : undefined} className={item(newActive)}>
        <Plus className="size-5" aria-hidden />
        <span className="max-w-full truncate px-1">New</span>
      </a>
      <button type="button" aria-expanded={openMobile} onClick={() => setOpenMobile(!openMobile)} className={item(openMobile)}>
        <Ellipsis className="size-5" aria-hidden />
        <span className="max-w-full truncate px-1">More</span>
      </button>
    </nav>
  )
}
