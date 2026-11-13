import { DiscordIcon, GitHubIcon } from './icons'
import { DISCORD_URL, Emoji, GITHUB_URL } from './ui'

export function Cta() {
  return (
    <section
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: 'clamp(96px, 16vw, 200px) clamp(14px, 4vw, 24px) clamp(104px, 16vw, 220px)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 22,
      }}
    >
      <img src="/assets/logo.svg" alt="" style={{ width: 52, height: 59 }} />
      <h2
        style={{
          margin: 0,
          fontSize: 'clamp(26px, 6vw, 36px)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          textWrap: 'pretty',
        }}
      >
        Join our community of agentic developers <Emoji e="💪" />
        <Emoji e="🦾" />
      </h2>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a
          href={DISCORD_URL}
          className="cta-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--success)',
            color: 'var(--background)',
            fontWeight: 600,
            fontSize: 16,
            borderRadius: 10,
            padding: '13px 26px',
          }}
        >
          <DiscordIcon width={19} height={15} />
          Join us on Discord
        </a>
        <a
          href={GITHUB_URL}
          className="cta-secondary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
            fontWeight: 500,
            fontSize: 16,
            borderRadius: 10,
            padding: '13px 26px',
          }}
        >
          <GitHubIcon size={17} />
          Star on GitHub
        </a>
      </div>
    </section>
  )
}
