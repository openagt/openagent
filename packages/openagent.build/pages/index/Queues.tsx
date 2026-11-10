import type { CSSProperties, ReactNode } from 'react'
import type { EmojiChar } from './ui'
import { cardStyle, CodeChip, Emoji, h3Style } from './ui'

const leadStyle = { color: '#d3c6aa', fontWeight: 500 } as const

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#9da9a0' }}>{children}</p>
}

function QueueCard({ title, icon, iconStyle, children }: { title: string; icon: EmojiChar; iconStyle: CSSProperties; children: ReactNode }) {
  return (
    <div
      style={{ ...cardStyle, padding: 'clamp(16px, 4.5vw, 24px)', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h4 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
        {title}{' '}
        <span aria-hidden style={{ marginLeft: 4, ...iconStyle }}>
          <Emoji e={icon} />
        </span>
      </h4>
      {children}
    </div>
  )
}

export function Queues() {
  return (
    <section id="queues" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h3 style={h3Style}>Queues</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <QueueCard title="AI Queue" icon="🤖" iconStyle={{ verticalAlign: 1 }}>
          <P>
            Queue of upcoming AI tasks — tasks are added by humans, or by{' '}
            agents (autonomously if no uncertainty, or after human
            confirmation otherwise).
          </P>
          <P>
            Agents autonomously populating the AI queue is what <span style={leadStyle}>makes AI autonomous</span>.
          </P>
          <P>
            Technically, it's just a <CodeChip fontSize={12}>TODO_AGENTS.md</CodeChip> file in your Git repositories.
          </P>
        </QueueCard>
        <QueueCard title="Human Queue" icon="🙋" iconStyle={{ verticalAlign: 0 }}>
          <P>
            Queue of pending human reviews — populated when agents need you to review
            (important) decisions with subtle pros and cons.
          </P>
          <P>
            <span style={leadStyle}>It's your cockpit</span> — it keeps humans in control.
          </P>
        </QueueCard>
      </div>
    </section>
  )
}
