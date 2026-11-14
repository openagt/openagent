import '../index/styles.css'
import { BADGES, mono } from '../index/ui'

// A 1200x630 banner (the Open Graph image size), rendered for screenshotting —
// no site chrome on purpose. Sized to stay legible at ~40% scale (X/Slack
// cards) with >=64px safe margins all around.
export default function Page() {
  return (
    // Dark whatever the visitor's computer asks for: it is the picture other sites show.
    <div
      className="dark"
      style={{
        position: 'relative',
        width: 1200,
        height: 630,
        background: 'var(--background)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 48,
        padding: '64px 88px',
        boxSizing: 'border-box',
        color: 'var(--foreground)',
      }}
    >
      {/* Soft glows so the background doesn't read as a flat void. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -140,
          top: -160,
          width: 720,
          height: 720,
          background: 'radial-gradient(circle, color-mix(in oklab, var(--success) 9%, transparent) 0%, transparent 62%)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: -180,
          bottom: -260,
          width: 640,
          height: 640,
          background: 'radial-gradient(circle, color-mix(in oklab, var(--primary) 6%, transparent) 0%, transparent 60%)',
        }}
      />

      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ position: 'relative', alignSelf: 'flex-start', fontSize: 40, fontWeight: 500, color: 'var(--muted-foreground)' }}>
            Babysit AI
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: '-3%',
                top: '58%',
                width: '106%',
                height: 5,
                borderRadius: 3,
                background: 'var(--danger)',
                transform: 'rotate(-5deg)',
              }}
            />
          </span>
          <div style={{ fontSize: 79, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05, whiteSpace: 'nowrap' }}>
            Autonomous AI
          </div>
        </div>
        <div style={{ fontSize: 31, color: 'var(--muted-foreground)', lineHeight: 1.4 }}>
          Make the important decisions,
          <br />
          let AI do the rest.
        </div>
        <div style={{ display: 'flex', gap: 13, fontFamily: mono, fontSize: 16.5, marginTop: 8 }}>
          {BADGES.map(([label, color]) => (
            <span
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                border: '1px solid var(--border)',
                borderRadius: 999,
                padding: '8px 17px',
                color,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Brand lockup: the name lives with the mark, not as orphan text. */}
      <div
        style={{
          position: 'relative',
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 26,
        }}
      >
        <img src="/assets/logo.svg" alt="" style={{ width: 320, height: 363 }} />
        <div
          style={{
            fontFamily: mono,
            fontSize: 22,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--success)',
          }}
        >
          OpenAgent
        </div>
      </div>
    </div>
  )
}
