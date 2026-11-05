import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

/**
 * Where "Dashboard" goes (#1919). On a computer with OpenAgent installed, this page is the
 * dashboard's own copy of the website, which answers `/_view` with 204: there it switches `/` to
 * the dashboard. Everywhere else it is the public website (404 there), and it goes to the page
 * that says how to get the dashboard.
 */
export function useDashboardHref(): string {
  const [href, setHref] = useState('/go-to-dashboard')
  useEffect(() => {
    void dashboardHere().then((here) => {
      if (here) setHref('/_view/dashboard')
    })
  }, [])
  return href
}

/** Asked once per page, however many of its parts lead to the dashboard. */
let asked: Promise<boolean> | undefined
function dashboardHere(): Promise<boolean> {
  asked ??= fetch('/_view', { method: 'HEAD', cache: 'no-store' }).then(
    (res) => res.status === 204,
    () => false,
  )
  return asked
}

const pillStyle: CSSProperties = {
  borderRadius: 7,
  padding: '4px 14px',
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

/** "Landing page | Dashboard", under the logo: the website is the landing page, so that side is the one lit. */
export function ViewToggle() {
  const dashboardHref = useDashboardHref()
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 3,
        border: '1px solid #4f585e',
        borderRadius: 10,
        background: '#232a2e',
      }}
    >
      <span aria-current="page" style={{ ...pillStyle, background: '#a7c080', color: '#232a2e' }}>
        Landing page
      </span>
      <a href={dashboardHref} className="view-toggle-off" style={{ ...pillStyle, color: '#d3c6aa' }}>
        Dashboard
      </a>
    </div>
  )
}
