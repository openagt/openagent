import { cn } from '../lib/utils.js'
import { inPlace } from '../lib/in-place.js'

/**
 * Whether this page is the dashboard answering the website's own name (#1919): there, and only
 * there, the server keeps the `openagent-view` cookie. Read at once rather than asked, so the
 * page's first frame has the toggle, which the switch's animation starts from.
 */
function onWebsiteName(): boolean {
  return document.cookie.split(';').some(part => part.trim().startsWith('openagent-view='))
}

/**
 * "Landing page | Dashboard", under the logo (#1919). The website draws the same toggle at the
 * same place and size (its `ViewToggle`): the pills' widths are fixed so the two never differ,
 * and the lit side is a thumb of its own, which the page switch slides from one side to the other
 * (`view-transition-name`, tailwind.css). Anywhere else (`localhost:4200`, a server) there is no
 * landing page to go to, and no toggle.
 *
 * Hidden for now (Rom and Suleiman, 2026-11-24): too unusual at this point, so the dashboard is the
 * only view and nothing draws this. Kept, with its routes and the website's own side, for the day
 * `openagent.build` is where a person chooses a server: to show it again, draw it in the sidebar's
 * header under the brand (`AgentHistory.tsx`) and give the website's its rule back (`styles.css`).
 */
export function ViewToggle() {
  if (!onWebsiteName()) return null
  // In the website's font whatever the page's is (Settings › Appearance), so the two toggles are one.
  const pill = "relative flex h-6 items-center justify-center rounded-md font-['IBM_Plex_Sans',ui-sans-serif,sans-serif] text-xs font-medium whitespace-nowrap"
  return (
    <div role="group" aria-label="View" className="relative inline-flex gap-0.5 self-start rounded-lg border border-sidebar-border p-0.5 [view-transition-name:oa-toggle]">
      <span aria-hidden className="absolute top-0.5 left-[calc(0.125rem+96px+0.125rem)] h-6 w-[84px] rounded-md bg-primary [view-transition-name:oa-toggle-thumb]" />
      {/* The labels after the thumb, and named apart from it: the switch draws them above the thumb as it slides. */}
      <span className="relative inline-flex gap-0.5 [view-transition-name:oa-toggle-labels]">
        {/* A plain link: the landing page is the website's, not a page of this app. */}
        <a href="/_view/landing" onClick={switchInPlace} className={cn(pill, 'w-[96px] text-muted-foreground transition-colors hover:text-foreground')}>
          Landing page
        </a>
        <span aria-current="page" className={cn(pill, 'w-[84px] text-primary-foreground')}>
          Dashboard
        </span>
      </span>
    </div>
  )
}

/**
 * The switch takes the place of the page it leaves in the history: both views are at `/`, so Back
 * could only show the view just left. It names that page, which the landing page's "Dashboard"
 * opens again. A click with a modifier, or another button, is the browser's.
 */
const switchInPlace = inPlace<HTMLAnchorElement>(event => {
  switching = true
  location.replace(`${event.currentTarget.href}?back=${encodeURIComponent(`${location.pathname}${location.search}`)}`)
})

/** The page is being left by the switch. */
let switching = false

/**
 * The page is being left for another document: only the switch animates. The stylesheet asks for
 * the animation on every move between two of the address's documents (`@view-transition`,
 * tailwind.css), and while it plays the page coming in takes no click: a press on its message box
 * goes to the page, and what is typed next goes nowhere. So any other move skips it, such as a
 * session's link opened in this tab or the address typed by an automation.
 */
export function onPageSwap(event: PageSwapEvent): void {
  if (!switching) event.viewTransition?.skipTransition()
}
