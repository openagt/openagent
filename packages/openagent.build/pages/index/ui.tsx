import type { CSSProperties, ReactNode } from 'react'

export const DISCORD_URL = 'https://discord.gg/qc8zvdzWNR'
export const GITHUB_URL = 'https://github.com/openagt/openagent'
export const NPM_URL = 'https://www.npmjs.com/package/@openagt/dashboard'

export const mono = "'IBM Plex Mono', monospace" as const

/** A step of the site's type scale (styles.css): its size and its line. */
export const text = (step: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl'): CSSProperties => ({
  fontSize: `var(--text-${step})`,
  lineHeight: `var(--leading-${step})`,
})

/** Prose: the body size, in lines of 68 characters at most. */
export const proseStyle: CSSProperties = { margin: 0, ...text('base'), maxWidth: 'var(--measure)', textWrap: 'pretty' }

/** The three claims under the hero's title; the banner says them too, each in its colour. */
export const BADGES = [
  ['100% Open Source', 'var(--success)'],
  ['100% Free', 'var(--warning)'],
  ['100% Local', 'var(--primary)'],
] as const

// A content section: max-width column with the shared vertical rhythm. The
// rhythm is a MARGIN, not padding: anchors target the border box, so nav
// clicks land on the section's content instead of a screen of padding.
export const sectionStyle: CSSProperties = {
  maxWidth: 'var(--container)',
  margin: 'var(--space-section) auto 0',
  padding: '0 var(--space-gutter)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-head)',
}

/** A section's heading: the scale's 40, tighter (28 on a phone, styles.css). */
export const h2Style: CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-heading)',
  lineHeight: 'var(--leading-heading)',
  fontWeight: 600,
  letterSpacing: '-0.02em',
}

// Subsection heading (the "How it works" children).
export const h3Style: CSSProperties = {
  margin: 0,
  ...text('lg'),
  fontWeight: 600,
}

/** Side by side where there is room, each at least `min` wide: a section's columns. */
export const columnsStyle = (min: number): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
  gap: 'var(--space-items) var(--space-columns)',
})

/** A column's title, then its sentences: a section's part, on the page itself. */
export const columnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }

/** A label over what it names ("Try:", "What is it?", "Any software"): the body face a step smaller, as written. */
export const labelStyle: CSSProperties = {
  ...text('sm'),
  fontWeight: 500,
  color: 'var(--muted-foreground)',
}

/** A section's opening: its heading on the column's left edge, its lead under it. */
export function SectionHead({ title, sub }: { title: ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 'var(--measure)' }}>
      <h2 style={h2Style}>{title}</h2>
      {sub && <p style={{ margin: 0, ...text('lg'), color: 'var(--muted-foreground)', textWrap: 'balance' }}>{sub}</p>}
    </div>
  )
}

// The note look, shared with note-shaped blocks that can't be a <p> (e.g. the
// prompts band, whose chip row needs a block container): muted text, around NoteText.
export const noteContainerStyle: CSSProperties = {
  margin: 0,
  ...text('sm'),
  color: 'var(--muted-foreground)',
}

const noteLabelStyle: CSSProperties = {
  fontWeight: 600,
  color: 'var(--foreground)',
  marginRight: 8,
}

/** A note's words: its "Note" label, then the note. */
export function NoteText({ children }: { children: ReactNode }) {
  return (
    <>
      <span style={noteLabelStyle}>Note</span> {children}
    </>
  )
}

export function Note({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p style={{ ...noteContainerStyle, ...style }}>
      <NoteText>{children}</NoteText>
    </p>
  )
}

/** "Coming soon", beside a feature that is not there yet. */
export function WipBadge() {
  return (
    <span
      style={{
        ...text('xs'),
        fontWeight: 600,
        color: 'var(--muted-foreground)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '0 6px',
        whiteSpace: 'nowrap',
      }}
    >
      Coming soon
    </span>
  )
}

// Emoji as static SVGs (Chrome's Noto set, in public/assets): identical on
// every platform instead of whatever the browser's emoji font ships.
const EMOJIS = {
  '💪': 'flex',
  '🦾': 'mech-arm',
  '🧭': 'compass',
  '🤖': 'robot',
  '🙋': 'hand-raised',
  '😕': 'confused',
  '🚀': 'rocket',
  '🚧': 'construction',
} as const
export type EmojiChar = keyof typeof EMOJIS

export function Emoji({ e }: { e: EmojiChar }) {
  return <img src={`/assets/emoji-${EMOJIS[e]}.svg`} alt={e} style={{ height: '1em', verticalAlign: '-0.12em' }} />
}

/** A path or a file name in the text, in mono a step (2px) under the text around it. */
export function CodeChip({ children }: { children: string }) {
  return (
    <code
      style={{
        // Wraps only when a line can't hold it (long paths on mobile); clone
        // keeps the border/padding on every line fragment.
        overflowWrap: 'anywhere',
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
        fontFamily: mono,
        fontSize: 'calc(1em - 2px)',
        background: 'var(--card)',
        // The border keeps the chip visible even on surfaces of its own fill (e.g. the
        // good-solution rows), where the background alone disappears.
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '0 4px',
        color: 'var(--foreground)',
      }}
    >
      {children}
    </code>
  )
}

/**
 * A capture of the dashboard (public/pictures/, taken by pictures.mjs), dark or light as the visitor's
 * computer asks, framed by a hairline. Its size is the capture's at half its pixels, so its box is
 * laid out before it arrives.
 */
export function Screenshot({
  name,
  width,
  height,
  alt,
  first,
}: {
  name: 'run' | 'waiting' | 'tickets'
  width: number
  height: number
  alt: string
  /** The page's first picture: fetched with the page (after its fonts), not when it nears the screen. */
  first?: boolean
}) {
  return (
    <picture>
      <source media="(prefers-color-scheme: light)" srcSet={`/pictures/${name}-light.webp`} />
      <img
        src={`/pictures/${name}-dark.webp`}
        width={width}
        height={height}
        alt={alt}
        loading={first ? 'eager' : 'lazy'}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          // An outline, not a border: a border would change the box's ratio once the picture arrives.
          outline: '1px solid var(--border)',
          outlineOffset: -1,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--card)',
        }}
      />
    </picture>
  )
}
