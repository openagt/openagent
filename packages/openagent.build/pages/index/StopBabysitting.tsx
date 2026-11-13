import type { ReactNode } from 'react'
import type { EmojiChar } from './ui'
import { cardStyle, CodeChip, Emoji, mono, SectionHead, sectionStyle } from './ui'

const ROW_STYLES = {
  bad: { bg: 'var(--background)', border: 'var(--border)', labelColor: 'var(--muted-foreground)' },
  good: { bg: 'var(--card)', border: 'var(--border)', labelColor: 'var(--success)' },
} as const

// Inline arrows in the mono font and accent green: the sans-serif glyphs are
// thin and vanish in the muted body text.
function Arrow({ glyph }: { glyph: '→' | '↔' }) {
  return <span style={{ fontFamily: mono, fontWeight: 500, fontSize: '1.25em' }}>{glyph}</span>
}

type Row = { kind: keyof typeof ROW_STYLES; emoji: EmojiChar; label: string; body: ReactNode }
const bad = (body: ReactNode): Row => ({ kind: 'bad', emoji: '😕', label: 'Bad fix', body })
const good = (body: ReactNode): Row => ({ kind: 'good', emoji: '🚀', label: 'Solution', body })

const PROBLEMS: { title: string; desc?: string; rows: Row[] }[] = [
  {
    title: 'AI is lazy',
    rows: [
      bad(
        <>
          Appending "DON'T BE LAZY" to your prompts <Arrow glyph="→" /> minimal improvement.
        </>,
      ),
      good(
        <>
          <b>Divide-and-conquer</b>: OpenAgent instructs AI to split large tasks into smaller subtasks. By
          focusing on one unit of work at a time, AI spends significantly more effort overall, resulting in much
          higher-quality output.
        </>,
      ),
      good(
        <><b>Coverage guarantees</b>: OpenAgent lets AI enumerate everything that needs to be done before writing code. AI then works through that checklist, ensuring comprehensive coverage and preventing lazy shortcuts.</>,
      ),
    ],
  },
  {
    title: 'Lazy AI plans',
    rows: [
      bad('Explicitly tell AI to deep dive important aspects.'),
      good(
        <>
          Automatic loop of critical feedback <Arrow glyph="↔" /> research <Arrow glyph="↔" /> confidence <Arrow glyph="↔" /> implementation.
        </>,
      ),
    ],
  },
  {
    title: 'Lazy low-quality code',
    desc: 'Despite AI being able to write high-quality code, it often goes for the quickest/laziest solution (not correct, not maintainable, not DRY).',
    rows: [
      bad(
        <>
          Appending "WRITE CLEAN CODE" to your prompts <Arrow glyph="→" /> minimal improvement.
        </>,
      ),
      good(<>When an agent makes complex changes, the agent adds <b>post-merge refactoring</b> prompts to the AI Queue (with low priority).</>),
      good(<>Automatic <b>routine security and code quality prompts</b> (when your usage quota has plenty of capacity).</>),
    ],
  },
  {
    title: 'AI makes important decisions without asking',
    rows: [
      bad('Tell AI "don\'t do this, research alternatives".'),
      good(
        <>
        OpenAgent makes AI <b>self-gauge its confidence</b> before starting to work.
        </>,
      ),
      good(
        <>It also makes AI <b>self-gauge the variability</b> of its plan: if there are alternatives with subtle pros and cons, show them to the user.</>,
      ),
    ],
  },
  {
    title: 'AI forgets',
    rows: [
      bad('You keep repeating yourself (previous decisions, business context, …).'),
      good(
        <><b>AI retains knowledge via files</b> such as <CodeChip fontSize={13}>knowledge-base/DECISIONS.md</CodeChip> and <CodeChip fontSize={13}>knowledge-base/INSIGHTS.md</CodeChip>.</>,
      ),
    ],
  },
]

export function StopBabysitting() {
  return (
    <section id="stop-babysitting" style={sectionStyle}>
      <SectionHead title="Stop babysitting" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {PROBLEMS.map((p) => (
          <div
            key={p.title}
            className="problem-card"
            style={{
              ...cardStyle,
              padding: 'clamp(18px, 4vw, 28px)',
              display: 'grid',
              gridTemplateColumns: '280px 1fr',
              gap: 32,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 11.5,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--danger)',
                }}
              >
                Problem
              </span>
              <h3 style={{ margin: 0, fontSize: 21, fontWeight: 600, lineHeight: 1.3 }}>{p.title}</h3>
              {p.desc && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--muted-foreground)' }}>{p.desc}</p>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {p.rows.map((r, i) => {
                const s = ROW_STYLES[r.kind]
                return (
                  <div
                    key={i}
                    className="solution-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '118px 1fr',
                      gap: 14,
                      alignItems: 'baseline',
                      padding: '12px 16px',
                      borderRadius: 9,
                      background: s.bg,
                      border: `1px solid ${s.border}`,
                    }}
                  >
                    <span style={{ fontFamily: mono, fontSize: 12, color: s.labelColor, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 16, verticalAlign: -2, marginRight: 4 }}>
                        <Emoji e={r.emoji} />
                      </span>
                      {r.label}
                    </span>
                    <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: 'var(--foreground)' }}>{r.body}</p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
