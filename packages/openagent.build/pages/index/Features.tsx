import type { ReactNode } from 'react'
import { columnsStyle, columnStyle, SectionHead, sectionStyle, text } from './ui'

/** One feature: its name, then what it does. */
function Feature({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={columnStyle}>
      <h3 style={{ margin: 0, ...text('base'), fontWeight: 600 }}>{title}</h3>
      <p style={{ margin: 0, ...text('base'), color: 'var(--muted-foreground)' }}>{children}</p>
    </div>
  )
}

export function Features() {
  return (
    <section id="features" style={sectionStyle}>
      <SectionHead title="Features" />
      <div style={columnsStyle(300)}>
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
        <Feature title="Dashboard">
          Pro-rata usage quota, current AI agents, queued AI tasks, queue of required reviews, "hot" tickets, and
          more.
        </Feature>
        <Feature title="Notifications">Get browser and/or Discord notifications when AI is finished or needs you.</Feature>
        <Feature title="Claude web bridge">Orchestrate agents via Claude Code Web for 0% local CPU usage.</Feature>
        <Feature title="Swarm of local computers">Orchestrate agents across multiple local computers.</Feature>
        <Feature title="Discord bot">Use the discord bot for agentic team conversations.</Feature>
      </div>
    </section>
  )
}
