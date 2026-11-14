import type { CSSProperties, ReactNode } from 'react'
import type { EmojiChar } from './ui'
import { CodeChip, Emoji, h3Style, Screenshot, text } from './ui'

const leadStyle = { color: 'var(--foreground)', fontWeight: 500 } as const

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, ...text('base'), maxWidth: 'var(--measure)', color: 'var(--muted-foreground)' }}>{children}</p>
}

/** A queue: its name in the split's third, what it is beside it. */
function Queue({ title, icon, iconStyle, children }: { title: string; icon: EmojiChar; iconStyle: CSSProperties; children: ReactNode }) {
  return (
    <div className="split" style={{ padding: 'var(--space-items) 0' }}>
      <h4 style={{ margin: 0, ...text('lg'), fontWeight: 600 }}>
        {title}{' '}
        <span aria-hidden style={{ marginLeft: 4, ...iconStyle }}>
          <Emoji e={icon} />
        </span>
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

export function Queues() {
  return (
    <section id="queues" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-items)' }}>
      <h3 style={{ ...h3Style, ...text('xl') }}>Queues</h3>
      <div className="rows">
        <Queue title="AI Queue" icon="🤖" iconStyle={{ verticalAlign: 1 }}>
          <P>
            Queue of upcoming AI tasks — tasks are added by humans, or by{' '}
            agents (autonomously if no uncertainty, or after human
            confirmation otherwise).
          </P>
          <P>
            Agents autonomously populating the AI queue is what <span style={leadStyle}>makes AI autonomous</span>.
          </P>
          <P>
            Technically, it's just a <CodeChip>TODO_AGENTS.md</CodeChip> file in your Git repositories.
          </P>
        </Queue>
        <Queue title="Human Queue" icon="🙋" iconStyle={{ verticalAlign: 0 }}>
          <P>
            Queue of pending human reviews — populated when agents need you to review
            (important) decisions with subtle pros and cons.
          </P>
          <P>
            <span style={leadStyle}>It's your cockpit</span> — it keeps humans in control.
          </P>
          <div style={{ marginTop: 16 }}>
            <Screenshot
              name="waiting"
              width={768}
              height={298}
              alt="The dashboard's Waiting on you: a run that needs an answer to Which way?, and one with a commit that needs a push."
            />
          </div>
        </Queue>
      </div>
    </section>
  )
}
