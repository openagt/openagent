import type { CSSProperties } from 'react'
import { cardStyle, noteContainerStyle, NoteText } from './ui'

const PACKS = ['Security audit', 'Code quality', 'Research', 'Product Management']

const chipStyle: CSSProperties = {
  borderRadius: 8,
  padding: '7px 14px',
  fontSize: 14,
  fontWeight: 600,
  color: '#d3c6aa',
}

// A demoted band, not a third pillar, in the site's Note dress — a <div> rather
// than the Note component because the chip row can't live inside its <p>.
export function Prompts() {
  return (
    <section id="prompts">
      <div style={{ ...noteContainerStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, textWrap: 'pretty' }}>
          <NoteText>
            Everything is powered by open source <b style={{ color: '#d3c6aa', fontWeight: 600 }}>state-of-the-art prompts</b> (you can also bring your own):
          </NoteText>
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {PACKS.map((title) => (
            <span key={title} style={{ ...cardStyle, ...chipStyle }}>
              {title}
            </span>
          ))}
          <span style={{ ...chipStyle, background: 'transparent', border: '1.5px dashed #4f585e', color: '#a7c080' }}>
            ＋ Add yours
          </span>
        </div>
      </div>
    </section>
  )
}
