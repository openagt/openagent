import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { CopiedStatus, useCopy } from './copy'
import { mono, text } from './ui'

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

/** One tab per package manager, in the commands' own size; picking one switches every command on the page. Named as one group. */
export function PmTabs() {
  const pm = usePm()
  return (
    <div role="group" aria-label="Package manager" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {PM_NAMES.map((name) => (
        <button
          key={name}
          className={'pm-tab pm-tab-' + name}
          aria-pressed={name === pm}
          onClick={() => pickPm(name)}
          style={{ borderRadius: 'var(--radius-md)', padding: '6px 12px', fontFamily: mono, ...text('sm'), cursor: 'pointer' }}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

const dollarStyle: CSSProperties = { userSelect: 'none', color: 'var(--muted-foreground)' }
/** A command with words after it: they follow the command, under it once the line is too narrow, and the `$` stays beside it. */
const followedLineStyle: CSSProperties = { display: 'flex', alignItems: 'baseline' }
const followedStyle: CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', gap: '2px 16px' }

/**
 * `$ command`, in every package manager, the picked one shown (all are pre-rendered, styles.css
 * shows one). They share one place, so the line is as wide as the longest and a pick moves nothing.
 */
function CommandLine({ command, after }: { command: Command; /** Said after each command, so it follows the picked one. */ after?: ReactNode }) {
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

/** Every command is one size, wherever it stands: its words 16 in, and 12 over and under them when they take two lines. */
const BOX = { ...text('sm'), minHeight: 44, padding: '12px 6px 12px 16px', gap: 16 } as const

/**
 * `$ command` in a box that copies it: a press of the pointer anywhere on it, or of its copy press, which the
 * keyboard reaches. The press shows a check once the command is copied. Not a button as a whole, so the command
 * in it can still be selected by hand. A quiet one, the second way beside the one a page recommends, has muted
 * words and no fill, and its edge shows only under the pointer.
 */
export function CommandBox({
  command,
  after,
  quiet,
}: {
  command: Command
  /** Said after the command. */
  after?: ReactNode
  quiet?: boolean
}) {
  const { copied, copy } = useCopy()
  const picked = usePickedCommand(command)
  const Icon = copied ? Check : Copy
  return (
    <span
      className="command-box"
      onClick={(e) => copy(picked, e)}
      style={{
        ...BOX,
        boxSizing: 'border-box',
        maxWidth: '100%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        textAlign: 'left',
        cursor: 'pointer',
        background: quiet ? 'transparent' : 'var(--card)',
        color: quiet ? 'var(--muted-foreground)' : undefined,
        border: `1px solid ${quiet ? 'transparent' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        fontFamily: mono,
      }}
    >
      <CommandLine command={command} after={after} />
      <button type="button" className={'copy-press' + (copied ? ' copied' : '')} aria-label={`Copy ${picked}`}>
        <Icon size={16} aria-hidden />
      </button>
      <CopiedStatus copied={copied} />
    </span>
  )
}
