import { useState } from 'react'
import type { OpenAgentEvent, ProjectError } from '../../src/index.js'
import { StartAgentForm } from './StartAgentForm.js'
import { ProjectActions } from './ProjectActions.js'
import { ProjectErrorBanner } from './ProjectErrorBanner.js'
import { ProjectSkillsLine } from './ProjectSkills.js'
import { AgentOverview } from './AgentOverview.js'
import { OpenQuestions } from './OpenQuestions.js'
import { ScrollArea } from './ui/scroll-area.js'

// The project home / launcher: the "New agent" page. It is never consumed by an agent: starting
// one appends an agent to the rail and adds that agent's own view (AgentView) alongside, and this
// page stays put, so you can launch again.
//
// It is laid out as an agent's page is. The agents that wait for an answer are rows at the top, in
// the chat's column (#1455 item 4), and the box to start an agent is at the bottom, where an agent's
// message box is. The project's Docs are not here: they are the Docs pane (Panes), on this page
// as on an agent's.
export function ProjectHome({
  projectId,
  projectName,
  scope = null,
  events,
  onAgentStarted,
  files,
  context,
  addContext,
  removeContext,
  toggleContext,
  onOpenAgent,
  errors,
  onProjectRemoved,
  onSkillsChanged,
}: {
  projectId: string
  /** The project's name, for the launcher's chip; absent until the projects are read. */
  projectName?: string | null | undefined
  /** The project picked in the sidebar (#1513), or null for all: the open questions shown are its only. */
  scope?: string | null
  events: OpenAgentEvent[]
  /** Carries the started agent's id through to the shell; dropping it is what #1169 was. */
  onAgentStarted?: ((intent: string, agentId: string, runsOn?: string) => void) | undefined
  files: string[]
  /** The Context set and its edits, owned by the shell and shared with the file tree (#492). */
  context: Set<string>
  addContext: (path: string) => void
  removeContext: (path: string) => void
  toggleContext: (path: string) => void
  /** Jump into a parked session (#1455 item 4) — possibly another project's. */
  onOpenAgent: (projectId: string, agentId: string) => void
  /** What the daemon currently finds wrong with the project (#1500), off the shell's project list. */
  errors?: ProjectError[] | undefined
  /** Told once the project is off the list, so the shell leaves its page. */
  onProjectRemoved?: (() => void) | undefined
  /** Told once the project's skills were written, deleted or committed: its pages may have changed. */
  onSkillsChanged?: (() => void) | undefined
}) {
  // The project's skills are opened from its ⋮ menu; the list itself is the skills line's, which reads them.
  // Held with the project it was opened for: the page stays mounted when another project is picked, and a list asked for here is not that project's.
  const [skillsFor, setSkillsFor] = useState<string | null>(null)
  return (
    <>
      <ProjectActions projectId={projectId} onProjectRemoved={onProjectRemoved} onOpenSkills={() => setSkillsFor(projectId)} />
      {/* Above everything, because an agent started on a project whose agent-data branch cannot
          reach origin (#1599) works from stale tickets and a queue nobody else will see. */}
      <ProjectErrorBanner errors={errors} />
      {/* What the project's skills need from the person, when they need something (#2023); with
          nothing to say there is no line, and the list opens from the menu above. */}
      <ProjectSkillsLine key={projectId} projectId={projectId} onChanged={onSkillsChanged} door={{ open: skillsFor === projectId, onClose: () => setSkillsFor(null) }} />
      {/* Laid out as an agent's page is: what waits for the person fills the page from the top, in
          the chat's column, and scrolls there; the box to start an agent stays at the bottom, in
          the place and at the width of an agent's message box. */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl">
          {events.length > 0 && <AgentOverview events={events} />}
          <OpenQuestions projectId={scope} onOpenAgent={onOpenAgent} />
        </div>
      </ScrollArea>
      <StartAgentForm
        projectId={projectId}
        projectName={projectName}
        onAgentStarted={onAgentStarted}
        files={files}
        context={context}
        addContext={addContext}
        removeContext={removeContext}
        toggleContext={toggleContext}
      />
    </>
  )
}
