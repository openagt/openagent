import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { CheckIcon } from './icons'
import { Construction } from 'lucide-react'
import { CodeChip, h2Style, sectionStyle, text, WipBadge } from './ui'

/**
 * The page's one moment: the sentence set large, its words coming to full strength in reading order
 * as it enters the screen, once. Drawn whole without scripting, under reduced motion, and when it
 * is already in view as the page starts.
 */
function Moment({ words }: { words: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const p = ref.current!
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || p.getBoundingClientRect().top < innerHeight) return
    p.classList.add('moment-armed')
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry!.isIntersecting) return
        p.classList.add('moment-on')
        seen.disconnect()
      },
      { threshold: 1 },
    )
    seen.observe(p)
    return () => seen.disconnect()
  }, [])
  return (
    <p
      ref={ref}
      className="moment"
      style={{ margin: 0, fontSize: 'var(--text-hero)', lineHeight: 'var(--leading-hero)', fontWeight: 600, letterSpacing: '-0.02em', textWrap: 'balance' }}
    >
      {words.split(' ').map((word, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span style={{ '--i': i } as CSSProperties}>{word}</span>
        </span>
      ))}
    </p>
  )
}

/** One of the framework's three promises: its name in the split's third, its points beside it. */
function Pillar({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="split" style={{ padding: 'var(--space-items) 0' }}>
      <h3 style={{ margin: 0, ...text('lg'), fontWeight: 600 }}>{title}</h3>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          ...text('base'),
          color: 'var(--muted-foreground)',
        }}
      >
        {children}
      </ul>
    </div>
  )
}

function Item({ children, marker }: { children: ReactNode; marker?: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 8 }}>
      {/* Fixed marker width: every row's text (and its wrapped lines) starts in the same column. */}
      <span style={{ color: 'var(--muted-foreground)', flex: 'none', width: 20 }}>{marker ?? <CheckIcon />}</span>
      <span>{children}</span>
    </li>
  )
}

export function YourFramework() {
  return (
    <section id="your-framework" style={sectionStyle}>
      <h2 style={h2Style}>Your framework</h2>
      <Moment words="It isn't our framework. It's yours." />
      <div className="rows">
        <Pillar title="Flexible">
          <Item>OpenAgent doesn't force anything — pick only the features you need</Item>
          <Item marker={<Construction size={16} aria-hidden style={{ verticalAlign: '-0.125em' }} />}>
            <WipBadge /> Customize anything to fit your needs
          </Item>
        </Pillar>
        <Pillar title="100% Local">
          <Item>Runs locally on your machine, like a desktop app</Item>
          <Item>No backdoors, no tracking</Item>
          <Item>
            <span>
              Memory is saved in your Git repository at <CodeChip>knowledge-base/*.md</CodeChip>
            </span>
          </Item>
          <Item>Data is fully yours</Item>
        </Pillar>
        <Pillar title="100% Open Source">
          <Item>Transparent — no hidden code</Item>
          <Item>
            Something's not working for you? Ask your favorite AI to make a Pull Request — we welcome agentic
            contributions!
          </Item>
        </Pillar>
      </div>
    </section>
  )
}
