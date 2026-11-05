import { cn } from '../lib/utils.js'

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
 */
export function ViewToggle() {
  if (!onWebsiteName()) return null
  // In the website's font whatever the page's is (Settings › Appearance), so the two toggles are one.
  const pill = "relative flex h-6 items-center justify-center rounded-md font-['IBM_Plex_Sans',ui-sans-serif,sans-serif] text-xs font-medium whitespace-nowrap"
  return (
    <div className="relative inline-flex gap-0.5 self-start rounded-lg border border-sidebar-border p-0.5 [view-transition-name:oa-toggle]">
      <span aria-hidden className="absolute top-0.5 left-[calc(0.125rem+96px+0.125rem)] h-6 w-[84px] rounded-md bg-primary [view-transition-name:oa-toggle-thumb]" />
      {/* The labels after the thumb, and named apart from it: the switch draws them above the thumb as it slides. */}
      <span className="relative inline-flex gap-0.5 [view-transition-name:oa-toggle-labels]">
        {/* A plain link: the landing page is the website's, not a page of this app. */}
        <a href="/_view/landing" className={cn(pill, 'w-[96px] text-muted-foreground transition-colors hover:text-foreground')}>
          Landing page
        </a>
        <span aria-current="page" className={cn(pill, 'w-[84px] text-primary-foreground')}>
          Dashboard
        </span>
      </span>
    </div>
  )
}
