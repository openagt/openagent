import type { ReactNode } from 'react'
import { cardStyle, CodeChip, Emoji, SectionHead, sectionStyle, WipBadge } from './ui'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        ...cardStyle,
        padding: 'clamp(18px, 4.5vw, 26px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h3>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          fontSize: 14.5,
          lineHeight: 1.55,
          color: '#9da9a0',
        }}
      >
        {children}
      </ul>
    </div>
  )
}

function Item({ children, marker }: { children: ReactNode; marker?: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 10 }}>
      {/* Fixed marker width: every row's text (and its wrapped lines) starts in the same column. */}
      <span style={{ color: '#a7c080', flex: 'none', width: 18 }}>{marker ?? '✓'}</span>
      <span>{children}</span>
    </li>
  )
}

export function YourFramework() {
  return (
    <section id="your-framework" style={sectionStyle}>
      <SectionHead
        title={
          <>
            <span style={{ color: '#a7c080' }}>Your</span> framework
          </>
        }
        sub="It isn't our framework. It's yours."
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <Card title="Flexible">
          <Item>OpenAgent doesn't force anything — pick only the features you need</Item>
          <Item marker={<Emoji e="🚧" />}>
            <WipBadge /> Customize anything to fit your needs
          </Item>
        </Card>
        <Card title="100% Local">
          <Item>Runs locally on your machine, like a desktop app</Item>
          <Item>No backdoors, no tracking</Item>
          <Item>
            <span>
              Memory is saved in your Git repository at <CodeChip fontSize={12.5}>knowledge-base/*.md</CodeChip>
            </span>
          </Item>
          <Item>Data is fully yours</Item>
        </Card>
        <Card title="100% Open Source">
          <Item>Transparent — no hidden code</Item>
          <Item>
            Something's not working for you? Ask your favorite AI to make a Pull Request — we welcome agentic
            contributions!
          </Item>
        </Card>
      </div>
    </section>
  )
}
