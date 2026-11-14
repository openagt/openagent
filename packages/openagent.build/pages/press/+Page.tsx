import '../index/styles.css'
import { pStyle, Step, Subpage } from '../index/Subpage'
import { CodeChip, text } from '../index/ui'

const BRAND_REPO = 'https://github.com/brillout/brand-the-framework'

/** The logo on a tile of the dark theme's page, or on white, its name under the tile. */
function Swatch({ dark, label }: { dark?: boolean; label: string }) {
  return (
    <figure style={{ flex: '1 1 200px', margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div
        className={dark ? 'dark' : undefined}
        style={{
          alignSelf: 'stretch',
          display: 'flex',
          justifyContent: 'center',
          background: dark ? 'var(--background)' : '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 32,
        }}
      >
        <img src="/assets/logo.svg" alt="OpenAgent logo" style={{ width: 72, height: 82 }} />
      </div>
      <figcaption style={{ ...text('sm'), color: 'var(--muted-foreground)' }}>{label}</figcaption>
    </figure>
  )
}

export default function Page() {
  return (
    <Subpage title="Press" lead="Logos, banners, and naming — everything you need to talk about OpenAgent.">
      <Step title="Logo">
        <p style={pStyle}>
          The mark is the <i>hexknot</i> — six interlocking strands forming a hexagon. It works on dark and light
          backgrounds:
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Swatch dark label="on dark" />
          <Swatch label="on light" />
        </div>
        <p style={pStyle}>
          Download: <a href="/assets/logo.svg">logo.svg</a> — more variants (palettes, sizes) can be generated with
          the <a href="https://brillout.github.io/brand-the-framework/">brand playground</a>.
        </p>
      </Step>
      <Step title="Name">
        <p style={pStyle}>
          The name is written <b style={{ color: 'var(--foreground)', fontWeight: 600 }}>OpenAgent</b> (one word, capital O, capital
          A), and the package is <CodeChip>@openagt/dashboard</CodeChip>.
        </p>
      </Step>
      <Step title="Banner">
        <a href="/banner.jpg">
          <img
            src="/banner.jpg"
            alt="OpenAgent banner"
            style={{ width: '100%', height: 'auto', display: 'block', outline: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}
          />
        </a>
        <p style={pStyle}>
          <a href="/banner.jpg">banner.jpg</a> (1200×630, the Open Graph size) is a screenshot of{' '}
          <a href="/banner">/banner</a> — to regenerate it, follow{' '}
          <a href="https://gist.github.com/brillout/e7d0a5585471c4ea40d43d2caaadafad">the instructions</a>.
        </p>
      </Step>
      <Step title="Brand assets">
        <p style={pStyle}>
          The logo sources, color palettes, and the generator live in <a href={BRAND_REPO}>brillout/brand-the-framework</a>.
          Reach out on <a href="https://discord.gg/qc8zvdzWNR">Discord</a> if you need more material.
        </p>
      </Step>
    </Subpage>
  )
}
