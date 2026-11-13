import type { Intervention, ProjectError, ProjectSummary } from '../../src/index.js'
import { StartAgentForm } from './StartAgentForm.js'
import { ProjectActions } from './ProjectActions.js'
import { ProjectErrorBanner } from './ProjectErrorBanner.js'
import { ProjectSkillsLine } from './ProjectSkills.js'
import { HumanQueueList } from './HumanQueueList.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Section } from './ui/section.js'
import type { StartPicks } from '../lib/started-from.js'
import { SESSIONS_ID } from '../../src/project-address.js'

// The project home / launcher: the "New agent session" page. It is never consumed by an agent: starting
// one appends an agent to the rail and adds that agent's own view (AgentView) alongside, and this
// page stays put, so you can launch again.
//
// The box to start an agent is what the page is for: from 768px up it stands at the page's optical
// centre with what waits on the person under it, in the chat's column (#1455 item 4), the Human
// Queue's own rows; on a phone it is at the bottom, where an agent's message box is, with the rows
// above it. Starting a run carries the box to its place on the run's page (StartAgentForm). The
// project's Docs are not here: they are the Docs pane (Panes), on this page as on an agent's.
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
      {/* The page is for the box: from 768px up it stands where the eye lands, its top at about 38% of
          the page, and what waits for the person is under it, scrolling under it and never pushing
          it. On a phone the box stays at the bottom, in the thumb's reach, with what waits above it,
          as an agent's page has its chat. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 max-md:hidden md:basis-[38%]" aria-hidden />
        <div className="shrink-0 max-md:order-last">
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
        </div>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="chat-scroll h-full">
          <div className="mx-auto w-full max-w-3xl">
            {/* No section at all when nothing waits: an empty "Waiting on you" is noise on every launch. */}
            {waiting.length > 0 && (
              // On the box's edges, as an agent's chat is; the rows reach past them by their own padding, so
              // their words start where the heading does.
              <Section title="Waiting on you" count={waiting.length} className="px-4 pt-6">
                <div className="-mx-3">
                  <HumanQueueList key={projectId} items={waiting} onOpenAgent={onOpenAgent} />
                </div>
              </Section>
            )}
            {/* What the project's skills need from the person, when they need something (#2023): a card
                under the agents that wait, in the same column; with nothing to say there is no card,
                and "Skills" under the box opens the project's Skills page in Settings. */}
            {!noProject && <ProjectSkillsLine key={projectId} projectId={projectId} onChanged={onSkillsChanged} />}
          </div>
        </ScrollArea>
      </div>
    </>
  )
}
