import type { CSSProperties } from 'react'
import { useCopy } from './copy'
import { kickerStyle, mono } from './ui'

export const PMS = {
  npm: { try: 'npx @openagt/dashboard', install: 'npm i -g @openagt/dashboard' },
  pnpm: { try: 'pnpm dlx @openagt/dashboard', install: 'pnpm add -g @openagt/dashboard' },
  bun: { try: 'bunx @openagt/dashboard', install: 'bun add -g @openagt/dashboard' },
  // `yarn dlx` is Yarn 2+ (Berry), which removed `yarn global add` — so the install line
  // falls back to npm, which every yarn user has, rather than pairing two commands no
  // single yarn generation can both run.
  yarn: { try: 'yarn dlx @openagt/dashboard', install: 'npm i -g @openagt/dashboard' },
} as const
export type Pm = keyof typeof PMS

const dollarStyle: CSSProperties = { userSelect: 'none', color: '#a7c080' }
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

// The choice lives on <html data-pm>, set before first paint by the +Head
// script (no FOUC) and mirrored to localStorage; CSS shows the matching
// variant, so no React state is involved.
export const currentPm = (): Pm => {
  const p = document.documentElement.dataset.pm
  return p && p in PMS ? (p as Pm) : 'npm'
}

export const pickPm = (name: Pm) => {
  document.documentElement.dataset.pm = name
  try {
    localStorage.setItem('pm', name)
  } catch {}
}

export function Hero() {
  const tryCopy = useCopy()
  const installCopy = useCopy()

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
        {(
          [
            ['100% Open Source', '#a7c080'],
            ['100% Free', '#dbbc7f'],
            ['100% Local', '#7fbbb3'],
          ] as const
        ).map(([label, color]) => (
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
              {(Object.keys(PMS) as Pm[]).map((name) => (
                <button
                  key={name}
                  className={'pm-tab pm-tab-' + name}
                  onClick={() => pickPm(name)}
                  style={{ borderRadius: 7, padding: '4px 13px', fontFamily: mono, fontSize: 12, cursor: 'pointer' }}
                >
                  {name}
                </button>
              ))}
              <Badge label={tryCopy.copied ? 'copied!' : 'copy'} copied={tryCopy.copied} />
            </div>
            <div
              className="copy-box"
              onClick={(e) => tryCopy.copy(PMS[currentPm()].try, e)}
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
                <span>
                  <span style={dollarStyle}>$ </span>
                  {(Object.keys(PMS) as Pm[]).map((name) => (
                    <span key={name} className={'pm-only pm-only-' + name}>
                      {PMS[name].try}
                    </span>
                  ))}
                </span>
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
          <span
            className="install-chip"
            onClick={(e) => installCopy.copy(`${PMS[currentPm()].install} && openagent`, e)}
            style={{
              position: 'relative',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              background: '#232a2e',
              border: '1px solid #475258',
              borderRadius: 7,
              padding: '4px 10px',
              fontFamily: mono,
              fontSize: 12.5,
              wordBreak: 'break-all',
            }}
          >
            <span>
              <span style={dollarStyle}>$ </span>
              {(Object.keys(PMS) as Pm[]).map((name) => (
                <span key={name} className={'pm-only pm-only-' + name}>
                  {PMS[name].install}
                </span>
              ))}
            </span>
            <span
              className={'copy-tip-side' + (installCopy.copied ? ' copied' : '')}
              style={{
                position: 'absolute',
                left: 'calc(100% + 11px)',
                top: '50%',
                transform: 'translateY(-50%)',
                background: '#14181b',
                color: '#d3c6aa',
                fontWeight: 600,
                fontSize: 9.5,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                borderRadius: 4,
                padding: '4px 8px',
                whiteSpace: 'nowrap',
                transition: 'opacity 0.15s',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              {installCopy.copied ? 'copied!' : 'copy'}
            </span>
          </span>
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
