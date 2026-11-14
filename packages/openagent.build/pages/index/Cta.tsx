import { DiscordIcon, GitHubIcon } from './icons'
import { BicepsFlexed, Bot } from 'lucide-react'
import { DISCORD_URL, GITHUB_URL, h2Style } from './ui'

export function Cta() {
  return (
    <section
      style={{
        maxWidth: 'var(--container)',
        margin: 'var(--space-section) auto 0',
        padding: '0 var(--space-gutter) var(--space-part)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      <img src="/assets/logo.svg" alt="" style={{ width: 52, height: 59 }} />
      <h2 style={h2Style}>
        Join our community of agentic developers{' '}
        <span style={{ display: 'inline-flex', gap: 4, verticalAlign: '-0.1em', color: 'var(--muted-foreground)' }}>
          <BicepsFlexed size="0.8em" role="img" aria-label="flexed biceps" />
          <Bot size="0.8em" role="img" aria-label="robot" />
        </span>
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
