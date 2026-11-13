import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { CopiedStatus, copyPress, useCopy } from './copy'
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

const picked = new Set<() => void>()

const pickPm = (name: Pm) => {
  document.documentElement.dataset.pm = name
  try {
    localStorage.setItem('pm', name)
  } catch {}
  for (const listener of picked) listener()
}

/** The package manager the visitor picked, for what the page says rather than shows (prerendered as npm). */
function usePm(): Pm {
  return useSyncExternalStore(
    (listener) => (picked.add(listener), () => picked.delete(listener)),
    currentPm,
    () => 'npm',
  )
}

/** `command` in the package manager the visitor picked: what a click copies, and what its press is named by. */
export const usePickedCommand = (command: Command): string => PMS[usePm()][command]

/** One tab per package manager; picking one switches every command on the page. */
export function PmTabs() {
  const pm = usePm()
  return (
    <>
      {PM_NAMES.map((name) => (
        <button
          key={name}
          className={'pm-tab pm-tab-' + name}
          aria-pressed={name === pm}
          onClick={() => pickPm(name)}
          style={{ borderRadius: 7, padding: '4px 13px', fontFamily: mono, fontSize: 12, cursor: 'pointer' }}
        >
          {name}
        </button>
      ))}
    </>
  )
}

const dollarStyle: CSSProperties = { userSelect: 'none', color: 'var(--success)' }
/** A command with words after it: they follow the command, under it once the line is too narrow, and the `$` stays beside it. */
const followedLineStyle: CSSProperties = { display: 'flex', alignItems: 'baseline' }
const followedStyle: CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', gap: '2px 16px' }

/**
 * `$ command`, in every package manager, the picked one shown (all are pre-rendered, styles.css
 * shows one). They share one place, so the line is as wide as the longest and a pick moves nothing.
 */
export function CommandLine({ command, after }: { command: Command; /** Said after each command, so it follows the picked one. */ after?: ReactNode }) {
  return (
    <span style={after === undefined ? undefined : followedLineStyle}>
      <span style={{ ...dollarStyle, whiteSpace: 'pre' }}>$ </span>
      <span className="pm-commands">
        {PM_NAMES.map((name) => (
          <span key={name} className={'pm-only pm-only-' + name} style={after === undefined ? undefined : followedStyle}>
            {after === undefined ? PMS[name][command] : <span>{PMS[name][command]}</span>}
            {after}
          </span>
        ))}
      </span>
    </span>
  )
}

const chipStyle: CSSProperties = {
  position: 'relative',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  background: 'var(--card)',
  border: '1px solid var(--border)',
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
  background: 'var(--foreground)',
  color: 'var(--background)',
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
  const text = usePickedCommand(command)
  return (
    <>
      <span className="install-chip" {...copyPress(`Copy ${text}`, (e) => copy(text, e))} style={{ ...chipStyle, ...style }}>
        <CommandLine command={command} />
        <span className={'copy-tip-side' + (copied ? ' copied' : '')} style={copyTipStyle}>
          {copied ? 'copied!' : 'copy'}
        </span>
      </span>
      <CopiedStatus copied={copied} />
    </>
  )
}
