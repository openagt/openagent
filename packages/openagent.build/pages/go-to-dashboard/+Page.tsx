import '../index/styles.css'
import type { CSSProperties, ReactNode } from 'react'
import { TopNav } from '../index/TopNav'
import { Footer } from '../index/Footer'
import { useCopy } from '../index/copy'
import { currentPm, pickPm, PMS } from '../index/Hero'
import type { Pm } from '../index/Hero'
import { h2Style, kickerStyle, mono } from '../index/ui'

const tipStyle: CSSProperties = {
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
}

// A click-to-copy command chip (the hero install-chip recipe). `body` renders
// the command; `resolve` returns what a click copies (the visible variant).
function Cmd({ body, resolve }: { body: ReactNode; resolve: () => string }) {
  const { copied, copy } = useCopy()
  return (
    <span
      className="install-chip"
      onClick={(e) => copy(resolve(), e)}
      style={{
        position: 'relative',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        background: '#232a2e',
        border: '1px solid #475258',
        borderRadius: 8,
        padding: '10px 14px',
        fontFamily: mono,
        fontSize: 14,
        wordBreak: 'break-all',
      }}
    >
      <span>
        <span style={{ userSelect: 'none', color: '#a7c080' }}>$ </span>
        {body}
      </span>
      <span className={'copy-tip-side' + (copied ? ' copied' : '')} style={tipStyle}>
        {copied ? 'copied!' : 'copy'}
      </span>
    </span>
  )
}

/** The command in the visitor's package manager (driven by `html[data-pm]`, like the hero). */
function PmCmd({ get }: { get: (pm: Pm) => string }) {
  return (
    <Cmd
      resolve={() => get(currentPm())}
      body={(Object.keys(PMS) as Pm[]).map((name) => (
        <span key={name} className={'pm-only pm-only-' + name}>
          {get(name)}
        </span>
      ))}
    />
  )
}

function PmTabs() {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
    </div>
  )
}

/** Package-manager tabs sitting tight above their command; both snippets share the global choice. */
function PmSnippet({ get }: { get: (pm: Pm) => string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <PmTabs />
      <PmCmd get={get} />
    </div>
  )
}

function Step({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={kickerStyle}>{kicker}</span>
      {children}
    </section>
  )
}

const pStyle: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.6, color: '#9da9a0', textWrap: 'pretty' }

export default function Page() {
  return (
    <>
      <TopNav />
      <main
        style={{
          maxWidth: 680,
          margin: '0 auto',
          padding: 'clamp(40px, 8vw, 80px) clamp(14px, 4vw, 24px) clamp(72px, 12vw, 120px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 40,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={h2Style}>Go to dashboard</h1>
          <p style={pStyle}>The dashboard runs 100% locally, on your computer.</p>
        </div>
        <Step kicker="Install">
          <p style={pStyle}>
            Install it, and from then on openagent.build opens your dashboard on this computer. It starts when you log in. macOS for now:
          </p>
          <PmSnippet get={(pm) => PMS[pm].install} />
        </Step>
        <Step kicker="One-time run">
          <p style={pStyle}>You just want to try it out? Run it once, no install:</p>
          <PmSnippet get={(pm) => PMS[pm].try} />
        </Step>
      </main>
      <Footer />
    </>
  )
}
