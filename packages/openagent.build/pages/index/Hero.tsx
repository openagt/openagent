import type { CSSProperties } from 'react'
import { CommandChip, CommandLine, PmTabs, pickedCommand } from './commands'
import { useCopy } from './copy'
import { BADGES, kickerStyle, mono } from './ui'
import { useDashboardHref } from './ViewToggle'

const commentStyle: CSSProperties = { color: '#859289' }
const cmdLineStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '2px 16px' }

function Badge({ label, copied }: { label: string; copied: boolean }) {
  return (
    <span
      className={'try-badge' + (copied ? ' copied' : '')}
      style={{
        marginLeft: 'auto',
        position: 'relative',
        background: '#14181b',
        color: '#d3c6aa',
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        borderRadius: 5,
        padding: '4px 9px',
        transition: 'opacity 0.15s',
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
  const dashboardHref = useDashboardHref()

  return (
    <header
      id="top"
      style={{
        maxWidth: 1120,
        margin: '0 auto',
        padding: 'clamp(32px, 6vw, 56px) clamp(14px, 4vw, 24px) 32px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'center',
          fontSize: 12,
          fontFamily: mono,
        }}
      >
        {BADGES.map(([label, color]) => (
          <span
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              border: '1px solid #475258',
              borderRadius: 999,
              padding: '5px 12px',
              color,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
            {label}
          </span>
        ))}
      </div>

      <h1
        style={{
          margin: 0,
          fontSize: 'clamp(32px, 11vw, 68px)',
          lineHeight: 1.08,
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}
      >
        <span
          className="strike"
          style={{
            display: 'table',
            position: 'relative',
            margin: '0 auto 0px',
            fontSize: 'clamp(26px, 6vw, 42px)',
            fontWeight: 500,
            color: '#9da9a0',
          }}
        >
          Babysit AI
        </span>
        Autonomous AI
      </h1>
      <p
        style={{
          margin: '-10px 0 0',
          fontSize: 'clamp(19px, 4.5vw, 25px)',
          fontWeight: 500,
          lineHeight: 1.45,
          color: '#d3c6aa',
          maxWidth: 680,
          textWrap: 'pretty',
        }}
      >
        Make the important decisions, let AI do the rest.
      </p>
      <a
        href={dashboardHref}
        className="dashboard-cta"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 6,
          background: '#a7c080',
          color: '#232a2e',
          borderRadius: 12,
          padding: '14px 30px',
          fontSize: 19,
          fontWeight: 600,
        }}
      >
        Dashboard <span aria-hidden>→</span>
      </a>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          alignItems: 'center',
          marginTop: 18,
          maxWidth: '100%',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', maxWidth: '100%' }}>
          <span style={kickerStyle}>Try:</span>
          <div
            className="try-box"
            style={{
              maxWidth: '100%',
              boxSizing: 'border-box',
              background: '#232a2e',
              border: '1.5px solid #a7c080',
              boxShadow: '0 0 0 4px rgba(167, 192, 128, 0.12)',
              borderRadius: 12,
              overflow: 'hidden',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '7px 8px',
                background: '#2d353b',
                borderBottom: '1px solid #3d484d',
              }}
            >
              <PmTabs />
              <Badge label={tryCopy.copied ? 'copied!' : 'copy'} copied={tryCopy.copied} />
            </div>
            <div
              className="copy-box"
              onClick={(e) => tryCopy.copy(pickedCommand('try'), e)}
              style={{
                position: 'relative',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                padding: '14px clamp(12px, 3vw, 20px)',
                fontFamily: mono,
                fontSize: 'clamp(11px, 3.4vw, 15px)',
              }}
            >
              <div style={cmdLineStyle}>
                <CommandLine command="try" />
                <span style={commentStyle}># One-shot (no install)</span>
              </div>
            </div>
          </div>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: '#9da9a0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: '100%',
          }}
        >
          Or install:
          <CommandChip command="install" />
        </p>
      </div>

      <div
        style={{
          marginTop: 16,
          paddingTop: 8,
          width: '100%',
          maxWidth: 1056,
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: 48,
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={kickerStyle}>What is it?</span>
          <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.7, color: '#9da9a0', textWrap: 'pretty' }}>
            It turns AI agents into autonomous teammates that handle work end-to-end — while you stay in control of key
            decisions.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={kickerStyle}>Any software</span>
          <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.7, color: '#9da9a0', textWrap: 'pretty' }}>
            (Semi-)autonomously build anything from simple web apps to complex software.
          </p>
        </div>
      </div>
    </header>
  )
}
