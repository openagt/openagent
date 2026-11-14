import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { mono, text } from './ui'

const SECTIONS: { id: string; title: ReactNode }[] = [
  { id: 'stop-babysitting', title: 'Stop babysitting' },
  { id: 'autonomous-ai', title: 'Autonomous AI' },
  { id: 'how-it-works', title: 'How it works' },
  { id: 'features', title: 'Features' },
  {
    id: 'your-framework',
    title: (
      <>
        <em style={{ fontStyle: 'italic' }}>Your</em> framework
      </>
    ),
  },
]

function scrollTop(e: MouseEvent) {
  e.preventDefault()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// Scroll-spy nav. The design export faked `position: sticky` with a spacer +
// `position: fixed` because its runtime wrapper broke sticky; without that
// wrapper, plain sticky works. `stuck` only drives the translucent-blur
// background and the border swap.
export function SectionNav() {
  const [active, setActive] = useState('')
  const [stuck, setStuck] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => {
      // A section claims the highlight once its content crosses just below the
      // viewport's midpoint — eager enough to follow the reader, without
      // flipping while the title still hugs the bottom edge. Nav clicks land
      // content at y=64, within the line.
      const spyLine = Math.max(130, window.innerHeight * 0.55)
      let a = ''
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= spyLine) a = s.id
      }
      // At the very bottom — the closing Cta screen — highlight nothing.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120) a = ''
      setActive(a)
      setStuck(barRef.current ? barRef.current.getBoundingClientRect().top <= 0 : false)
      // keep URL hash in sync with the visible section
      const hash = a ? '#' + a : ''
      if (window.location.hash !== hash) {
        history.replaceState(null, '', hash || window.location.pathname + window.location.search)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <div
        className="on-this-page"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
          padding: '64px var(--space-gutter) 8px',
          color: 'var(--muted-foreground)',
          fontFamily: mono,
          ...text('xs'),
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          userSelect: 'none',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
          style={{ flex: 'none' }}
        >
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
        </svg>
        On this page
      </div>

      <div
        ref={barRef}
        className="section-nav-wrap"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: stuck ? 'color-mix(in oklab, var(--card) 92%, transparent)' : 'var(--card)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderTop: stuck ? 'none' : '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          className="section-nav"
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '0 var(--space-gutter)',
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: 24,
            overflowX: 'auto',
            scrollbarWidth: 'none',
            fontFamily: mono,
            ...text('sm'),
            whiteSpace: 'nowrap',
          }}
        >
          {/* The back-to-top logo appears only once the bar is stuck (fades in;
              keeps its layout slot so the links never shift). */}
          <a
            href="#top"
            onClick={scrollTop}
            title="Back to top"
            aria-hidden={!stuck}
            tabIndex={stuck ? undefined : -1}
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              padding: '12px 2px',
              opacity: stuck ? 1 : 0,
              transition: 'opacity var(--duration-enter) var(--ease-out)',
              pointerEvents: stuck ? 'auto' : 'none',
            }}
          >
            <img
              src="/assets/logo.svg"
              alt="OpenAgent — back to top"
              style={{ width: 22, height: 25, display: 'block' }}
            />
          </a>
          <span style={{ flex: 1 }} />
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={'#' + s.id}
              className={'section-link' + (active === s.id ? ' active' : '')}
              style={{ flex: 'none', padding: '12px 2px' }}
            >
              {s.title}
            </a>
          ))}
          <span style={{ flex: 1 }} />
        </div>
      </div>
    </>
  )
}
