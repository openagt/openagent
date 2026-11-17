import type { CSSProperties, ReactNode } from 'react'
import { Footer } from './Footer'
import { TopNav } from './TopNav'
import { h2Style, h3Style, proseStyle, text } from './ui'

/** A subpage's paragraph. */
export const pStyle: CSSProperties = { ...proseStyle, color: 'var(--muted-foreground)' }

/** A page beside the landing page (/press, /go-to-dashboard): the site's nav and footer around one column, its title and lead first. */
export function Subpage({ title, lead, under, children }: {
  title: string
  lead: string
  /** What belongs to the title and its lead, close under them: the page's one press, or a choice for all it holds. */
  under?: ReactNode
  children?: ReactNode
}) {
  return (
    // At least the window's height, so a short page's footer sits at its bottom.
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <TopNav />
      <div style={{ flexGrow: 1 }}>
        {/* On the home's column, its left edge with the home's sections and the footer; read in lines of the measure. */}
        <main
          id="main"
          style={{
            maxWidth: 'var(--container)',
            margin: '0 auto',
            padding: 'var(--space-part) var(--space-gutter)',
          }}
        >
          <div style={{ maxWidth: 'var(--measure)', display: 'flex', flexDirection: 'column', gap: 'var(--space-part)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h1 style={h2Style}>{title}</h1>
              <p style={pStyle}>{lead}</p>
              {under && <div style={{ marginTop: 16 }}>{under}</div>}
            </div>
            {children}
          </div>
        </main>
      </div>
      {/* A block, not a flex item: as one, the footer's auto margins shrink it to its words. */}
      <div>
        <Footer />
      </div>
    </div>
  )
}

/** One part of a subpage, under its heading; a quiet one, the second way beside the one the page recommends, a step smaller and muted. */
export function Step({ title, quiet, children }: { title: string; quiet?: boolean; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: quiet ? 8 : 16 }}>
      <h2 style={quiet ? { ...h3Style, ...text('base'), color: 'var(--muted-foreground)' } : h3Style}>{title}</h2>
      {children}
    </section>
  )
}
