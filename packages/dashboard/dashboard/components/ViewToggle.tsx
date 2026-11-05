import { useEffect, useState } from 'react'
import { cn } from '../lib/utils.js'

/**
 * "Landing page | Dashboard", under the logo (#1919). Shown only where this dashboard answers the
 * website's own name with the website's copy beside it, which says so on `/_view` with 204;
 * anywhere else (`localhost:4200`, a server) there is no landing page to go to.
 */
export function ViewToggle() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    fetch('/_view', { method: 'HEAD', cache: 'no-store' })
      .then(res => setShown(res.status === 204))
      .catch(() => {})
  }, [])
  if (!shown) return null
  const pill = 'rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap'
  return (
    <div className="inline-flex gap-0.5 self-start rounded-lg border border-sidebar-border p-0.5">
      {/* A plain link: the landing page is the website's, not a page of this app. */}
      <a href="/_view/landing" className={cn(pill, 'text-muted-foreground transition-colors hover:text-foreground')}>
        Landing page
      </a>
      <span aria-current="page" className={cn(pill, 'bg-primary text-primary-foreground')}>
        Dashboard
      </span>
    </div>
  )
}
