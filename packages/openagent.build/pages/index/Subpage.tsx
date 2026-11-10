import type { CSSProperties, ReactNode } from 'react'
import { Footer } from './Footer'
import { TopNav } from './TopNav'
import { h2Style, kickerStyle } from './ui'

/** A subpage's paragraph. */
export const pStyle: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.6, color: '#9da9a0', textWrap: 'pretty' }

/** A page beside the landing page (/press, /go-to-dashboard): the site's nav and footer around one column, its title and lead first. */
export function Subpage({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <>
      <TopNav />
      <main
        style={{
          maxWidth: 680,
          margin: '0 auto',
          padding: 'clamp(40px, 8vw, 80px) clamp(14px, 4vw, 24px) clamp(72px, 12vw, 120px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 40,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={h2Style}>{title}</h1>
          <p style={pStyle}>{lead}</p>
        </div>
        {children}
      </main>
      <Footer />
    </>
  )
}

/** One part of a subpage, under its kicker. */
export function Step({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={kickerStyle}>{kicker}</span>
      {children}
    </section>
  )
}
