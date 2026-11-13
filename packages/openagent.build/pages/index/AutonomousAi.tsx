import type { ReactNode } from 'react'
import { cardStyle, CodeChip, Note, SectionHead, sectionStyle, text } from './ui'

function Item({ children }: { children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: 'var(--success)' }}>✓</span>
      {children}
    </li>
  )
}

function Card({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div
      style={{
        ...cardStyle,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
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
          ...text('base'),
        }}
      >
        {children}
      </ul>
    </div>
  )
}

const noteFlexStyle = { flex: 1, minWidth: 'min(280px, 100%)', boxSizing: 'border-box' } as const

export function AutonomousAi() {
  return (
    <section id="autonomous-ai" style={sectionStyle}>
      <SectionHead title="Autonomous AI" sub="Focus on what matters, let AI do the rest." />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: 16,
        }}
      >
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
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Note style={noteFlexStyle}>Agents still ask for your confirmation for non-obvious decisions.</Note>
        <Note style={noteFlexStyle}>You're still in control — only pick the autonomicity that works for you.</Note>
      </div>
    </section>
  )
}
