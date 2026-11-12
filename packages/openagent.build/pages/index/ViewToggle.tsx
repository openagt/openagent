import { useEffect, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'

/**
 * Where "Dashboard" goes (#1919). On a computer with OpenAgent installed, this page is the
 * dashboard's own copy of the website, which answers `/_view` with 204: there it switches `/` to
 * the dashboard. Everywhere else it is the public website (200 there, its `public/_view` file), and
 * it goes to the page that says how to get the dashboard.
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

/**
 * Asked once per page, however many of its parts lead to the dashboard. The answer also settles
 * whether the toggle shows (`html[data-installed]`, set before first paint from the view cookie):
 * the public website, reached with a cookie an uninstalled dashboard left, hides it and forgets
 * the cookie.
 */
let asked: Promise<boolean> | undefined
function dashboardHere(): Promise<boolean> {
  asked ??= fetch('/_view', { method: 'HEAD', cache: 'no-store' }).then(
    (res) => {
      const here = res.status === 204
      if (here) document.documentElement.dataset.installed = ''
      else forgetInstalled()
      return here
    },
    () => false,
  )
  return asked
}

function forgetInstalled(): void {
  delete document.documentElement.dataset.installed
  document.cookie = 'openagent-view=; Path=/; Max-Age=0; Secure; SameSite=Lax'
}

const pillStyle: CSSProperties = {
  position: 'relative',
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

/**
 * "Landing page | Dashboard", under the logo: the website is the landing page, so that side is
 * lit. The dashboard draws the same toggle at the same place and size (its `ViewToggle`): the
 * pills' widths are fixed so the two never differ, and the lit side is a thumb of its own, which
 * the page switch slides from one side to the other (`view-transition-name`, styles.css).
 */
export function ViewToggle({ style }: { style?: CSSProperties }) {
  const dashboardHref = useDashboardHref()
  return (
    <div
      // Shown only where OpenAgent is installed (styles.css), with no dashboard to switch to elsewhere.
      className="view-toggle"
      style={{
        // The thumb is placed in it: in place, or where the caller puts it.
        position: 'relative',
        ...style,
        gap: 2,
        padding: 2,
        border: '1px solid #4f585e',
        borderRadius: 8,
        background: '#232a2e',
        viewTransitionName: 'oa-toggle',
      }}
    >
      <span
        aria-hidden
        style={{ position: 'absolute', top: 2, left: 2, width: 96, height: 24, borderRadius: 6, background: '#a7c080', viewTransitionName: 'oa-toggle-thumb' }}
      />
      {/* The labels after the thumb, and named apart from it: the switch draws them above the thumb as it slides. */}
      <span style={{ position: 'relative', display: 'inline-flex', gap: 2, viewTransitionName: 'oa-toggle-labels' }}>
        <span aria-current="page" style={{ ...pillStyle, width: 96, color: '#232a2e' }}>
          Landing page
        </span>
        <a href={dashboardHref} onClick={switchInPlace} className="view-toggle-off" style={{ ...pillStyle, width: 84, color: '#d3c6aa' }}>
          Dashboard
        </a>
      </span>
    </div>
  )
}

/**
 * The switch to the dashboard takes the place of this page in the history: both views are at `/`,
 * so Back could only show the view just left. A click with a modifier, or another button, is the browser's.
 */
export function switchInPlace(event: MouseEvent<HTMLAnchorElement>): void {
  if (!event.currentTarget.pathname.startsWith('/_view/')) return
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  location.replace(event.currentTarget.href)
}
