import { List } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { text } from './ui'

const SECTIONS: { id: string; title: string }[] = [
  { id: 'stop-babysitting', title: 'Stop babysitting' },
  { id: 'autonomous-ai', title: 'Autonomous AI' },
  { id: 'how-it-works', title: 'How it works' },
  { id: 'features', title: 'Features' },
  { id: 'your-framework', title: 'Your framework' },
]

function scrollTop(e: MouseEvent) {
  e.preventDefault()
  window.scrollTo({ top: 0 })
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
          padding: 'var(--space-part) var(--space-gutter) 8px',
          color: 'var(--muted-foreground)',
          ...text('sm'),
          fontWeight: 500,
          userSelect: 'none',
        }}
      >
        <List size={16} aria-hidden style={{ flex: 'none' }} />
        On this page
      </div>

      <div
        ref={barRef}
        className="section-nav-wrap"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          // Once stuck, a strip the page shows through, blurred.
          background: stuck ? 'color-mix(in oklab, var(--background) 72%, transparent)' : 'var(--card)',
          backdropFilter: 'blur(12px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(12px) saturate(1.4)',
          borderTop: stuck ? 'none' : '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          className="section-nav"
          style={{
            maxWidth: 'var(--container)',
            margin: '0 auto',
            padding: '0 var(--space-gutter)',
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: 24,
            overflowX: 'auto',
            scrollbarWidth: 'none',
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
