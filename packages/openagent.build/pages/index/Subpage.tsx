import type { CSSProperties, ReactNode } from 'react'
import { Footer } from './Footer'
import { TopNav } from './TopNav'
import { h2Style, h3Style, proseStyle } from './ui'

/** A subpage's paragraph. */
export const pStyle: CSSProperties = { ...proseStyle, color: 'var(--muted-foreground)' }

/** A page beside the landing page (/press, /go-to-dashboard): the site's nav and footer around one column, its title and lead first. */
export function Subpage({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    // At least the window's height, so a short page's footer sits at its bottom.
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <TopNav />
      <div style={{ flexGrow: 1 }}>
        <main
          id="main"
          style={{
            maxWidth: 720,
            margin: '0 auto',
            padding: 'var(--space-part) var(--space-gutter)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-part)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={h2Style}>{title}</h1>
            <p style={pStyle}>{lead}</p>
          </div>
          {children}
        </main>
      </div>
      {/* A block, not a flex item: as one, the footer's auto margins shrink it to its words. */}
      <div>
        <Footer />
      </div>
    </div>
  )
}

/** One part of a subpage, under its heading. */
export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={h3Style}>{title}</h2>
      {children}
    </section>
  )
}
