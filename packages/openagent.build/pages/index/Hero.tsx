import type { ReactNode } from 'react'
import { CommandBox, PmTabs } from './commands'
import { CheckIcon } from './icons'
import { BADGES, labelStyle, proseStyle, Screenshot, text } from './ui'
import { switchInPlace, useDashboardHref } from './ViewToggle'

/** A label beside its command; on a phone, over it. */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="labelled" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px 12px', maxWidth: '100%' }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </span>
  )
}

export function Hero() {
  const dashboardHref = useDashboardHref()

  return (
    <header
      id="top"
      style={{
        maxWidth: 'var(--container)',
        margin: '0 auto',
        padding: 'var(--space-head) var(--space-gutter) 32px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <ul
        className="claims"
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          ...text('sm'),
          color: 'var(--muted-foreground)',
        }}
      >
        {BADGES.map(([label]) => (
          <li key={label} style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            <CheckIcon />
            {label}
          </li>
        ))}
      </ul>

      <h1
        style={{
          margin: 0,
          fontSize: 'var(--text-hero)',
          lineHeight: 'var(--leading-hero)',
          fontWeight: 600,
          letterSpacing: '-0.02em',
        }}
      >
        <del
          className="strike"
          style={{
            display: 'table',
            textDecoration: 'none',
            position: 'relative',
            margin: '0 auto',
            fontSize: 'var(--text-struck)',
            lineHeight: 'var(--leading-struck)',
            fontWeight: 500,
            color: 'var(--muted-foreground)',
          }}
        >
          Babysit AI
        </del>
        Autonomous AI
      </h1>
      <p
        style={{
          margin: 0,
          ...text('lg'),
          fontWeight: 500,
          color: 'var(--foreground)',
          maxWidth: 'var(--measure)',
          textWrap: 'pretty',
        }}
      >
        Make the important decisions, let AI do the rest.
      </p>
      <a
        href={dashboardHref}
        onClick={switchInPlace}
        className="press press-primary dashboard-cta"
        style={{ marginTop: 8 }}
      >
        Dashboard <span aria-hidden>→</span>
      </a>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 16, maxWidth: '100%' }}>
        <PmTabs />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '8px 32px', maxWidth: '100%' }}>
          <Labelled label="Try:">
            <CommandBox command="try" size="large" after={<span style={{ color: 'var(--muted-foreground)' }}># One-shot (no install)</span>} />
          </Labelled>
          <Labelled label="Or install:">
            <CommandBox command="install" size="small" />
          </Labelled>
        </div>
      </div>

      <div style={{ width: '100%', marginTop: 32 }}>
        <Screenshot
          name="run"
          first
          alt="The OpenAgent dashboard: an agent's run asks which way to go, its recommended answer picked, beside the project's pages and runs."
        />
      </div>

      <div
        style={{
          marginTop: 32,
          width: '100%',
          maxWidth: 'var(--container)',
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: 'var(--space-items) var(--space-columns)',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelStyle}>What is it?</span>
          <p style={{ ...proseStyle, color: 'var(--muted-foreground)' }}>
            It turns AI agents into autonomous teammates that handle work end-to-end — while you stay in control of key
            decisions.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelStyle}>Any software</span>
          <p style={{ ...proseStyle, color: 'var(--muted-foreground)' }}>
            (Semi-)autonomously build anything from simple web apps to complex software.
          </p>
        </div>
      </div>
    </header>
  )
}
