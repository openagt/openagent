import type { ReactNode } from 'react'
import { CheckIcon } from './icons'
import { CodeChip, columnsStyle, columnStyle, Note, Screenshot, SectionHead, sectionStyle, text } from './ui'

function Item({ children }: { children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: 'var(--muted-foreground)' }}>
        <CheckIcon />
      </span>
      {children}
    </li>
  )
}

function Card({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div style={columnStyle}>
      <h3 style={{ margin: 0, ...text('lg'), fontWeight: 600 }}>{title}</h3>
      <p style={{ margin: 0, ...text('sm'), color: 'var(--muted-foreground)' }}>{lead}</p>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginTop: 8,
          ...text('base'),
        }}
      >
        {children}
      </ul>
    </div>
  )
}

export function AutonomousAi() {
  return (
    <section id="autonomous-ai" style={sectionStyle}>
      <SectionHead title="Autonomous AI" sub="Focus on what matters, let AI do the rest." />
      <div style={columnsStyle(400)}>
        <Card title="Autonomous Product Management" lead="Let AI autonomously:">
          <Item>Test &amp; review</Item>
          <Item>Research, plan, and prioritize your tickets</Item>
          <Item>Turn your team conversations into tickets</Item>
          <Item>
            <span>
              Save your team conversations to <CodeChip>{'conversations/<DATE>_<TOPICS_SLUG>.md'}</CodeChip>
            </span>
          </Item>
          <Item>Market research</Item>
        </Card>
        <Card title="Autonomous Coding" lead="Let AI autonomously implement:">
          <Item>Quick-wins</Item>
          <Item>Quality refactoring</Item>
          <Item>UX improvements</Item>
          <Item>Consensual work</Item>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Note>Agents still ask for your confirmation for non-obvious decisions.</Note>
          <Note>You're still in control — only pick the autonomicity that works for you.</Note>
        </div>
        <Screenshot
          name="tickets"
          width={768}
          height={327}
          alt="The dashboard's Tickets page: the project's two tickets, Dark mode and Login page, each with a Plan button, and Add to queue for both."
        />
      </div>
    </section>
  )
}
