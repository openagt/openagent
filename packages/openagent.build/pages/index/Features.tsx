import type { ReactNode } from 'react'
import { cardStyle, SectionHead, sectionStyle } from './ui'

const featureCardStyle = {
  ...cardStyle,
  padding: 'clamp(18px, 4vw, 26px) clamp(16px, 4.5vw, 28px)',
  display: 'flex',
  flexDirection: 'column',
} as const

/** One feature's card: its name, then what it does. */
function Feature({ title, gap = 12, children }: { title: string; gap?: number; children: ReactNode }) {
  return (
    <div style={{ ...featureCardStyle, gap }}>
      <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#9da9a0' }}>{children}</p>
    </div>
  )
}

export function Features() {
  return (
    <section id="features" style={sectionStyle}>
      <SectionHead title="Features" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <Feature title="Bring your own subscription">
          Use your AI subscription — OpenAgent orchestrates agents via your Claude Code / Codex
          installation, like humans do.
        </Feature>
        <Feature title="Optimal quota usage">
          Stop wasting unused quota — OpenAgent drives AI autonomy for optimal quota usage:
          maximum daily usage while keeping enough quota space for manual prompts.
        </Feature>
        <Feature title="Bring your own prompts">
          Save and quickly re-use your favorite prompts. Share them with your teammates or keep them personal.
        </Feature>
        <Feature title="Dashboard" gap={14}>
          Pro-rata usage quota, current AI agents, queued AI tasks, queue of required reviews, "hot" tickets, and
          more.
        </Feature>
        <Feature title="Notifications">Get browser and/or Discord notifications when AI is finished or needs you.</Feature>
        <Feature title="Claude Code Web">Orchestrate agents via Claude Code Web for 0% local CPU usage.</Feature>
        <Feature title="Swarm of local computers">Orchestrate agents across multiple local computers.</Feature>
        <Feature title="Discord bot">Use the discord bot for agentic team conversations.</Feature>
      </div>
    </section>
  )
}
