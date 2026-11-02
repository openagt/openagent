import type { CSSProperties, ReactNode } from 'react'

export const DISCORD_URL = 'https://discord.gg/qc8zvdzWNR'
export const GITHUB_URL = 'https://github.com/openagt/openagent'
export const NPM_URL = 'https://www.npmjs.com/package/@openagt/dashboard'

export const mono = "'IBM Plex Mono', monospace" as const

// A content section: max-width column with the shared vertical rhythm. The
// rhythm is a MARGIN, not padding: anchors target the border box, so nav
// clicks land on the section's content instead of a screen of padding.
export const sectionStyle: CSSProperties = {
  maxWidth: 1120,
  margin: 'clamp(72px, 13vw, 140px) auto 0',
  padding: '0 clamp(14px, 4vw, 24px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 36,
}

export const h2Style: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(30px, 6vw, 40px)',
  fontWeight: 700,
  letterSpacing: '-0.015em',
}

// Subsection heading (the "How it works" children).
export const h3Style: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(23px, 4.5vw, 28px)',
  fontWeight: 700,
  letterSpacing: '-0.01em',
}

export const cardStyle: CSSProperties = {
  background: '#343f44',
  border: '1px solid #3d484d',
  borderRadius: 12,
}

// Small mono uppercase label (e.g. "Try", "What is it?", "Problem").
export const kickerStyle: CSSProperties = {
  fontFamily: mono,
  fontSize: 11.5,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#a7c080',
}

// Centered chapter break: the one centered element on a left-anchored page, so
// the eye finds section boundaries instantly. The accent bar is straight — at
// this size a tilt reads as misalignment, not as a hero-strike echo.
export function SectionHead({ title, sub }: { title: ReactNode; sub?: string | React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 12,
        maxWidth: 640,
        margin: '0 auto',
      }}
    >
      <h2 style={h2Style}>{title}</h2>
      <span aria-hidden style={{ width: 68, height: 4, borderRadius: 2, background: '#a7c080' }} />
      {sub && <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: '#9da9a0' }}>{sub}</p>}
    </div>
  )
}

// The note look, shared with note-shaped blocks that can't be a <p> (e.g. the
// prompts band, whose chip row needs a block container).
export const noteContainerStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.6,
  color: '#9da9a0',
  background: 'rgba(219, 188, 127, 0.07)',
  borderLeft: '3px solid #dbbc7f',
  borderRadius: '0 8px 8px 0',
  padding: '12px 16px',
}

export const noteLabelStyle: CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#dbbc7f',
  marginRight: 10,
}

export function Note({ children, style, label }: { children: ReactNode; style?: CSSProperties; label?: ReactNode }) {
  return (
    <p style={{ ...noteContainerStyle, ...style }}>
      {label ?? <span style={noteLabelStyle}>Note</span>}{' '}
      <span
        style={{
          fontStyle: 'italic',
        }}
      >
        {children}
      </span>
    </p>
  )
}

export function WipBadge({ style, icon = true }: { style?: CSSProperties; icon?: boolean }) {
  return (
    <>
      {icon && (
        <>
          <Emoji e="🚧" />{' '}
        </>
      )}
      <span
        style={{
          fontStyle: 'normal',
          fontFamily: mono,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: '#dbbc7f',
          border: '1px solid rgba(219, 188, 127, 0.4)',
          borderRadius: 4,
          padding: '1px 6px',
          whiteSpace: 'nowrap',
          ...style,
        }}
      >
         Coming soon
      </span>
    </>
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

export function Emoji({ e, style }: { e: EmojiChar; style?: CSSProperties }) {
  return (
    <img
      src={`/assets/emoji-${EMOJIS[e]}.svg`}
      alt={e}
      style={{ height: '1em', verticalAlign: '-0.12em', ...style }}
    />
  )
}

export function CodeChip({ children, fontSize }: { children: string; fontSize: number }) {
  return (
    <code
      style={{
        // Wraps only when a line can't hold it (long paths on mobile); clone
        // keeps the border/padding on every line fragment.
        overflowWrap: 'anywhere',
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
        // Upright even inside italic contexts (notes).
        fontStyle: 'normal',
        fontFamily: mono,
        fontSize,
        background: '#232a2e',
        // The border keeps the chip visible even on #232a2e surfaces (e.g. the
        // good-solution rows), where the background alone disappears.
        border: '1px solid #475258',
        borderRadius: 5,
        padding: '1px 6px',
        color: '#dbbc7f',
      }}
    >
      {children}
    </code>
  )
}
