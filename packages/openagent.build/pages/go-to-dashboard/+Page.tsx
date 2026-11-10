import '../index/styles.css'
import type { CSSProperties, ReactNode } from 'react'
import { TopNav } from '../index/TopNav'
import { Footer } from '../index/Footer'
import { CommandChip, PmTabs } from '../index/commands'
import type { Command } from '../index/commands'
import { h2Style, kickerStyle } from '../index/ui'

/** Package-manager tabs sitting tight above their command, in a larger chip than the hero's; both snippets share the global choice. */
function PmSnippet({ command }: { command: Command }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <PmTabs />
      </div>
      <CommandChip command={command} style={{ alignSelf: 'flex-start', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
    </div>
  )
}

function Step({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={kickerStyle}>{kicker}</span>
      {children}
    </section>
  )
}

const pStyle: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.6, color: '#9da9a0', textWrap: 'pretty' }

export default function Page() {
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
          <h1 style={h2Style}>Go to dashboard</h1>
          <p style={pStyle}>The dashboard runs 100% locally, on your computer.</p>
        </div>
        <Step kicker="Install">
          <p style={pStyle}>
            Install it, and from then on openagent.build opens your dashboard on this computer. It starts when you log in. macOS and Linux for now:
          </p>
          <PmSnippet command="install" />
        </Step>
        <Step kicker="One-time run">
          <p style={pStyle}>You just want to try it out? Run it once, no install:</p>
          <PmSnippet command="try" />
        </Step>
      </main>
      <Footer />
    </>
  )
}
