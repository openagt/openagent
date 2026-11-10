import type { CSSProperties } from 'react'
import { useCopy } from './copy'
import { mono } from './ui'

// Trying runs the dashboard once; installing starts it at every login, at openagent.build (#1919).
const PMS = {
  npm: { try: 'npx @openagt/dashboard', install: 'npx @openagt/install' },
  pnpm: { try: 'pnpm dlx @openagt/dashboard', install: 'pnpm dlx @openagt/install' },
  bun: { try: 'bunx @openagt/dashboard', install: 'bunx @openagt/install' },
  yarn: { try: 'yarn dlx @openagt/dashboard', install: 'yarn dlx @openagt/install' },
} as const
type Pm = keyof typeof PMS
export type Command = keyof (typeof PMS)[Pm]

const PM_NAMES = Object.keys(PMS) as Pm[]

// The choice lives on <html data-pm>, set before first paint by the +Head
// script (no FOUC) and mirrored to localStorage; CSS shows the matching
// variant, so no React state is involved.
const currentPm = (): Pm => {
  const p = document.documentElement.dataset.pm
  return p && p in PMS ? (p as Pm) : 'npm'
}

const pickPm = (name: Pm) => {
  document.documentElement.dataset.pm = name
  try {
    localStorage.setItem('pm', name)
  } catch {}
}

/** `command` in the package manager the visitor picked: what a click copies. */
export const pickedCommand = (command: Command): string => PMS[currentPm()][command]

/** One tab per package manager; picking one switches every command on the page. */
export function PmTabs() {
  return (
    <>
      {PM_NAMES.map((name) => (
        <button
          key={name}
          className={'pm-tab pm-tab-' + name}
          onClick={() => pickPm(name)}
          style={{ borderRadius: 7, padding: '4px 13px', fontFamily: mono, fontSize: 12, cursor: 'pointer' }}
        >
          {name}
        </button>
      ))}
    </>
  )
}

const dollarStyle: CSSProperties = { userSelect: 'none', color: '#a7c080' }

/** `$ command`, in every package manager, the picked one shown (all are pre-rendered, styles.css shows one). */
export function CommandLine({ command }: { command: Command }) {
  return (
    <span>
      <span style={dollarStyle}>$ </span>
      {PM_NAMES.map((name) => (
        <span key={name} className={'pm-only pm-only-' + name}>
          {PMS[name][command]}
        </span>
      ))}
    </span>
  )
}

const chipStyle: CSSProperties = {
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
}

const copyTipStyle: CSSProperties = {
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

/** A click-to-copy chip holding `command`, with its "copy" tip beside it; `style` sizes and places it where the hero's would not do. */
export function CommandChip({ command, style }: { command: Command; style?: CSSProperties }) {
  const { copied, copy } = useCopy()
  return (
    <span className="install-chip" onClick={(e) => copy(pickedCommand(command), e)} style={{ ...chipStyle, ...style }}>
      <CommandLine command={command} />
      <span className={'copy-tip-side' + (copied ? ' copied' : '')} style={copyTipStyle}>
        {copied ? 'copied!' : 'copy'}
      </span>
    </span>
  )
}
