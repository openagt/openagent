import '../index/styles.css'
import type { CSSProperties, ReactNode } from 'react'
import { TopNav } from '../index/TopNav'
import { Footer } from '../index/Footer'
import { CodeChip, h2Style, kickerStyle } from '../index/ui'

const BRAND_REPO = 'https://github.com/brillout/brand-the-framework'

const pStyle: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.6, color: '#9da9a0', textWrap: 'pretty' }

function Step({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={kickerStyle}>{kicker}</span>
      {children}
    </section>
  )
}

function Swatch({ bg, label, border }: { bg: string; label: string; border: string }) {
  return (
    <div
      style={{
        flex: '1 1 200px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: '28px 20px 16px',
      }}
    >
      <img src="/assets/logo.svg" alt="OpenAgent logo" style={{ width: 72, height: 82 }} />
      <span style={{ fontSize: 12.5, color: '#859289' }}>{label}</span>
    </div>
  )
}

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
          <h1 style={h2Style}>Press</h1>
          <p style={pStyle}>Logos, banners, and naming — everything you need to talk about OpenAgent.</p>
        </div>
        <Step kicker="Logo">
          <p style={pStyle}>
            The mark is the <i>hexknot</i> — six interlocking strands forming a hexagon. It works on dark and light
            backgrounds:
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <Swatch bg="#232a2e" border="#3d484d" label="on dark" />
            <Swatch bg="#ffffff" border="#3d484d" label="on light" />
          </div>
          <p style={pStyle}>
            Download: <a href="/assets/logo.svg">logo.svg</a> — more variants (palettes, sizes) can be generated with
            the <a href="https://brillout.github.io/brand-the-framework/">brand playground</a>.
          </p>
        </Step>
        <Step kicker="Name">
          <p style={pStyle}>
            The name is written <b style={{ color: '#d3c6aa', fontWeight: 600 }}>OpenAgent</b> (one word, capital O, capital
            A), and the package is <CodeChip fontSize={13}>@openagt/dashboard</CodeChip>.
          </p>
        </Step>
        <Step kicker="Banner">
          <a href="/banner.jpg" style={{ alignSelf: 'flex-start' }}>
            <img
              src="/banner.jpg"
              alt="OpenAgent banner"
              style={{ width: 'min(476px, 100%)', height: 'auto', display: 'block', outline: '1px solid #3d484d', borderRadius: 4 }}
            />
          </a>
          <p style={pStyle}>
            <a href="/banner.jpg">banner.jpg</a> (1200×630, the Open Graph size) is a screenshot of{' '}
            <a href="/banner">/banner</a> — to regenerate it, follow{' '}
            <a href="https://gist.github.com/brillout/e7d0a5585471c4ea40d43d2caaadafad">the instructions</a>.
          </p>
        </Step>
        <Step kicker="Brand assets">
          <p style={pStyle}>
            The logo sources, color palettes, and the generator live in <a href={BRAND_REPO}>brillout/brand-the-framework</a>.
            Reach out on <a href="https://discord.gg/qc8zvdzWNR">Discord</a> if you need more material.
          </p>
        </Step>
      </main>
      <Footer />
    </>
  )
}
