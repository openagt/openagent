import type { CSSProperties } from 'react'
import { CommandChip, CommandLine, PmTabs, usePickedCommand } from './commands'
import { CopiedStatus, copyPress, useCopy } from './copy'
import { BADGES, labelStyle, mono, proseStyle, Screenshot, text } from './ui'
import { switchInPlace, useDashboardHref } from './ViewToggle'

const commentStyle: CSSProperties = { color: 'var(--muted-foreground)' }

function Badge({ label, copied }: { label: string; copied: boolean }) {
  return (
    <span
      className={'try-badge' + (copied ? ' copied' : '')}
      style={{
        marginLeft: 'auto',
        position: 'relative',
        background: 'var(--foreground)',
        color: 'var(--background)',
        fontWeight: 600,
        ...text('xs'),
        borderRadius: 'var(--radius-sm)',
        padding: '2px 8px',
        transition: 'opacity var(--duration-hover) var(--ease-out)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {label}
    </span>
  )
}

export function Hero() {
  const tryCopy = useCopy()
  const tryCommand = usePickedCommand('try')
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
      <div
        style={{
          display: 'flex',
          gap: '4px 16px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          ...text('sm'),
          color: 'var(--muted-foreground)',
        }}
      >
        {BADGES.map(([label]) => (
          <span key={label}>{label}</span>
        ))}
      </div>

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

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          alignItems: 'center',
          marginTop: 16,
          maxWidth: '100%',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', maxWidth: '100%' }}>
          <span style={labelStyle}>Try:</span>
          <div
            className="try-box"
            style={{
              maxWidth: '100%',
              boxSizing: 'border-box',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 8px',
                background: 'var(--background)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <PmTabs />
              <Badge label={tryCopy.copied ? 'copied!' : 'copy'} copied={tryCopy.copied} />
            </div>
            <div
              className="copy-box"
              {...copyPress(`Copy ${tryCommand}`, (e) => tryCopy.copy(tryCommand, e))}
              style={{
                position: 'relative',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '12px 16px',
                fontFamily: mono,
                ...text('sm'),
              }}
            >
              <CommandLine command="try" after={<span style={commentStyle}># One-shot (no install)</span>} />
            </div>
            <CopiedStatus copied={tryCopy.copied} />
          </div>
        </div>
        <p
          style={{
            margin: 0,
            ...text('sm'),
            color: 'var(--muted-foreground)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: '100%',
          }}
        >
          Or install:
          <CommandChip command="install" />
        </p>
      </div>

      <div style={{ width: '100%', marginTop: 32 }}>
        <Screenshot
          name="run"
          width={1440}
          height={600}
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
