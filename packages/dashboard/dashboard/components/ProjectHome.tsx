import type { Intervention, ProjectError, ProjectSummary } from '../../src/index.js'
import { StartAgentForm } from './StartAgentForm.js'
import { ProjectActions } from './ProjectActions.js'
import { ProjectErrorBanner } from './ProjectErrorBanner.js'
import { ProjectSkillsLine } from './ProjectSkills.js'
import { HumanQueueList } from './HumanQueueList.js'
import { ScrollArea } from './ui/scroll-area.js'
import type { StartPicks } from '../lib/started-from.js'
import { SESSIONS_ID } from '../../src/project-address.js'

// The project home / launcher: the "New agent session" page. It is never consumed by an agent: starting
// one appends an agent to the rail and adds that agent's own view (AgentView) alongside, and this
// page stays put, so you can launch again.
//
// It is laid out as an agent's page is. What waits on the person is rows at the top, in the chat's
// column (#1455 item 4), the Human Queue's own rows, and the box to start an agent is at the bottom, where an agent's
// message box is. The project's Docs are not here: they are the Docs pane (Panes), on this page
// as on an agent's.
//
// With no project (`SESSIONS_ID`), the page is the same without what a project has: its skills.
export function ProjectHome({
  projectId,
  projectName,
  waiting,
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
  home,
  projects,
  onPickProject,
  onProjectAdded,
}: {
  projectId: string
  /** Every project, for the picker of where the session works. */
  projects: readonly ProjectSummary[]
  /** Open the "New agent session" page of another project, or of no project. */
  onPickProject: (projectId: string) => void
  /** A repo was added as a project from the picker. */
  onProjectAdded: () => void
  /** The project's name, for the launcher's chip; absent until the projects are read. */
  projectName?: string | null | undefined
  /** The Human Queue, already only the project picked in the sidebar's (#1513) when one is picked. */
  waiting: Intervention[]
  /** Carries the started agent's id through to the shell; dropping it is what #1169 was. */
  onAgentStarted?: ((intent: string, agentId: string, runsOn?: string, startedIn?: string, picks?: StartPicks) => void) | undefined
  files: string[]
  /** The Context set and its edits, owned by the shell and shared with the file tree (#492). */
  context: Set<string>
  addContext: (path: string) => void
  removeContext: (path: string) => void
  toggleContext: (path: string) => void
  /** Open the session a row is about (#1455 item 4) — possibly another project's. */
  onOpenAgent: (projectId: string, agentId: string) => void
  /** What the daemon currently finds wrong with the project (#1500), off the shell's project list. */
  errors?: ProjectError[] | undefined
  /** Told once the project is off the list, so the shell leaves its page. */
  onProjectRemoved?: (() => void) | undefined
  /** Told once the project's skills were written, deleted or committed: its pages may have changed. */
  onSkillsChanged?: (() => void) | undefined
  /** The saved machine the project is on, when only another computer of the person's has it (elsewhere.ts): it is removed there, not here. */
  home?: string | undefined
}) {
  const noProject = projectId === SESSIONS_ID
  return (
    <>
      <ProjectActions projectId={projectId} onProjectRemoved={home === undefined ? onProjectRemoved : undefined} />
      {/* Above everything, because an agent started on a project whose agent-data branch cannot
          reach origin (#1599) works from stale tickets and a queue nobody else will see. */}
      <ProjectErrorBanner errors={errors} />
      {/* Laid out as an agent's page is: what waits for the person fills the page from the top, in
          the chat's column, and scrolls there; the box to start an agent stays at the bottom, in
          the place and at the width of an agent's message box. */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl">
          {/* No section at all when nothing waits: an empty "Waiting on you" is noise on every launch. */}
          {waiting.length > 0 && (
            <section aria-label="Waiting on you" className="p-3">
              {/* Set in as far as the rows' own text, so the title, the rows and "Show more" start at one place. */}
              <h2 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Waiting on you · {waiting.length}</h2>
              <HumanQueueList key={projectId} items={waiting} onOpenAgent={onOpenAgent} />
            </section>
          )}
          {/* What the project's skills need from the person, when they need something (#2023): a card
              under the agents that wait, in the same column; with nothing to say there is no card,
              and "Skills" under the box opens the project's Skills page in Settings. */}
          {!noProject && <ProjectSkillsLine key={projectId} projectId={projectId} onChanged={onSkillsChanged} />}
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
        home={home}
        projects={projects}
        onPickProject={onPickProject}
        onProjectAdded={onProjectAdded}
      />
    </>
  )
}
