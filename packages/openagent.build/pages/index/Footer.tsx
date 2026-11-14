import { DiscordIcon, GitHubIcon, NpmIcon } from './icons'
import { DISCORD_URL, GITHUB_URL, NPM_URL, text } from './ui'

// 28 high, a target a pointer finds; 44 on a phone (styles.css).
const linkStyle = { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 0', color: 'var(--muted-foreground)' } as const

export function Footer() {
  return (
    <footer
      className="site-footer"
      style={{
        borderTop: '1px solid var(--border)',
        padding: '24px var(--space-gutter)',
        maxWidth: 'var(--container)',
        margin: '0 auto',
        boxSizing: 'border-box',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        // space-between (not an auto margin on the links) so that when the
        // links wrap onto their own line they align left under the brand.
        justifyContent: 'space-between',
        gap: 24,
        rowGap: 12,
        ...text('sm'),
        color: 'var(--muted-foreground)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src="/assets/logo.svg" alt="" style={{ width: 20, height: 23 }} />
        OpenAgent
      </span>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px' }}>
        <a href={DISCORD_URL} className="footer-link" style={linkStyle}>
          <DiscordIcon width={15} height={12} />
          Discord
        </a>
        <a href={GITHUB_URL} className="footer-link" style={linkStyle}>
          <GitHubIcon size={14} />
          GitHub
        </a>
        <a href={NPM_URL} className="footer-link" style={linkStyle}>
          <NpmIcon size={14} />
          npm
        </a>
      </span>
    </footer>
  )
}
