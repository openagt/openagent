import type { CSSProperties, MouseEvent } from 'react'
import { DiscordIcon, GitHubIcon } from './icons'
import { DISCORD_URL, GITHUB_URL, text } from './ui'
import { ViewToggle } from './ViewToggle'

const navBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--foreground)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '6px 12px',
  ...text('sm'),
  fontWeight: 500,
}

// On the landing page the logo scrolls back up; on subpages it navigates home.
function goHome(e: MouseEvent) {
  if (window.location.pathname !== '/') return
  e.preventDefault()
  history.replaceState(null, '', window.location.pathname + window.location.search)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/*
 * The logo, the wordmark and the toggle are drawn here at the very place and size the dashboard
 * draws them, the top of its sidebar, so switching between the two pages moves neither (#1919).
 */

export function TopNav() {
  return (
    <nav style={{ position: 'relative', minHeight: 94 }}>
      {/* Right-clicking the logo opens the press page (logo downloads etc.). */}
      <a
        href="/"
        onClick={goHome}
        onContextMenu={(e) => {
          e.preventDefault()
          window.location.href = '/press'
        }}
        style={{
          position: 'absolute',
          left: 12,
          top: 14,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: 'var(--foreground)',
          whiteSpace: 'nowrap',
          viewTransitionName: 'oa-brand',
        }}
      >
        <img src="/assets/logo.svg" alt="OpenAgent logo" style={{ width: 21, height: 24, display: 'block' }} />
        <span style={{ fontSize: 17, lineHeight: '24px', fontWeight: 500 }}>
          OpenAgent
        </span>
      </a>
      <ViewToggle style={{ position: 'absolute', left: 8, top: 56 }} />
      {/* At the page's right edge, as the logo is at its left, and level with it. */}
      <div
        style={{
          position: 'absolute',
          right: 12,
          top: 8,
          display: 'flex',
          gap: 12,
        }}
      >
        <a href={DISCORD_URL} className="nav-btn" style={navBtnStyle}>
          <DiscordIcon width={16} height={13} />
          <span>Discord</span>
        </a>
        <a href={GITHUB_URL} className="nav-btn" style={navBtnStyle}>
          <GitHubIcon size={16} />
          <span>GitHub</span>
        </a>
      </div>
    </nav>
  )
}
