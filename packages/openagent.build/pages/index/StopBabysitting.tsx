import type { ReactNode } from 'react'
import type { EmojiChar } from './ui'
import { CodeChip, Emoji, mono, proseStyle, SectionHead, sectionStyle, text } from './ui'


// Inline arrows in the mono font: the sans-serif glyphs are thin and vanish in the text.
function Arrow({ glyph }: { glyph: '→' | '↔' }) {
  return <span style={{ fontFamily: mono, fontWeight: 500 }}>{glyph}</span>
}

type Row = { kind: 'bad' | 'good'; emoji: EmojiChar; label: string; body: ReactNode }
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
        <><b>AI retains knowledge via files</b> such as <CodeChip>knowledge-base/DECISIONS.md</CodeChip> and <CodeChip>knowledge-base/INSIGHTS.md</CodeChip>.</>,
      ),
    ],
  },
]

export function StopBabysitting() {
  return (
    <section id="stop-babysitting" style={sectionStyle}>
      <SectionHead title="Stop babysitting" />
      <div>
        {PROBLEMS.map((p, i) => (
          <div
            key={p.title}
            className="problem-row"
            style={{
              display: 'grid',
              gridTemplateColumns: '280px 1fr',
              gap: 32,
              padding: 'var(--space-items) 0',
              borderTop: i === 0 ? undefined : '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...text('sm'), fontWeight: 500, color: 'var(--muted-foreground)' }}>Problem</span>
              <h3 style={{ margin: 0, ...text('lg'), fontWeight: 600 }}>{p.title}</h3>
              {p.desc && <p style={{ margin: '4px 0 0', ...text('sm'), color: 'var(--muted-foreground)' }}>{p.desc}</p>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {p.rows.map((r, i) => (
                <div
                  key={i}
                  className="solution-row"
                  style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16, alignItems: 'baseline' }}
                >
                  <span style={{ ...text('sm'), color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
                    <span style={{ marginRight: 6 }}>
                      <Emoji e={r.emoji} />
                    </span>
                    {r.label}
                  </span>
                  <p style={{ ...proseStyle, color: 'var(--foreground)' }}>{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
