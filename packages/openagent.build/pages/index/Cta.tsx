import { DiscordIcon, GitHubIcon } from './icons'
import { DISCORD_URL, Emoji, GITHUB_URL, text } from './ui'

export function Cta() {
  return (
    <section
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: 'var(--space-section) var(--space-gutter)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      <img src="/assets/logo.svg" alt="" style={{ width: 52, height: 59 }} />
      <h2
        style={{
          margin: 0,
          ...text('xl'),
          fontWeight: 600,
          letterSpacing: '-0.01em',
          textWrap: 'pretty',
        }}
      >
        Join our community of agentic developers <Emoji e="💪" />
        <Emoji e="🦾" />
      </h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a href={DISCORD_URL} className="press press-primary">
          <DiscordIcon width={20} height={16} />
          Join us on Discord
        </a>
        <a href={GITHUB_URL} className="press press-quiet">
          <GitHubIcon size={16} />
          Star on GitHub
        </a>
      </div>
    </section>
  )
}
