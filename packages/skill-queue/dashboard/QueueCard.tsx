import { FastForward, Play } from 'lucide-react'
import { PageLink, Section, StartAgentButton, cn, pathsIn, useFileNames, useModuleHost, type ModuleCardProps } from '@openagt/dashboard/module'
import { fanOutLabel, fanOutPress, isWorkingOn, unclaimedEntries, workOnEntryPrompt } from '../src/module.js'
import { AgentOnEntry, EntryTitle, entryView } from './entry.js'
import { useQueueStarts } from './starts.js'
import { BatchCount } from './batch-count.js'
import { useQueueReads } from './reads.js'

// The Overview's AI Queue card: every project's open entries, the work agents pick up on their own,
// grouped by project and shown in full. No "+N more": this is the plan, and a collapsed plan is one
// you cannot read. Its data is `queue --local` in each project, the very list an agent reads. An
// entry that names a file another page opens reads as that page's name for it (a ticket's title),
// and the link at its heading opens the Queue page, where an entry is also removed and added.
//
// Two ways to act, and they are different acts. The play button beside an entry STARTS it: one
// agent, on that entry alone, and the dashboard lands on the run. The project header carries the
// project's batch act: a fan-out that starts one agent per top entry, as many as the count beside
// it says, each pinned to its own entry, without leaving the Overview. Both are split buttons: the
// chevron beside each hands its prompt to the project's launcher instead of spending an agent on
// the settings the card cannot show.

export function QueueCard({ projects }: ModuleCardProps) {
  const host = useModuleHost()
  const { reads, loaded } = useQueueReads(projects)
  const starts = useQueueStarts(host)
  const names = useFileNames(reads.map(read => ({ projectId: read.project.id, paths: read.entries.flatMap(pathsIn) })))
  const { inFlight, error } = starts

  const shown = reads.filter(read => read.entries.length > 0 || read.error !== undefined)
  const total = reads.reduce((sum, read) => sum + read.entries.length, 0)
  return (
    <Section title="AI Queue" count={loaded && total > 0 ? total : undefined} action={<PageLink href={host.pageHref('queue')} onOpen={() => host.openPage('queue')}>Queue</PageLink>}>
      {loaded && shown.length === 0 && !error ? null : <p className="-mt-1 mb-3 text-xs text-muted-foreground">Tasks AI will work on next</p>}
      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        <ul className="space-y-4">
          {shown.map(read => {
            const { project, entries } = read
            // An entry an agent is on gets no second one: the batch starts from the top of the others.
            const free = unclaimedEntries(entries, read.working)
            const count = starts.batchOf(project.id, free)
            return (
              <li key={project.id}>
                <div className="flex w-full items-center gap-2">
                  <span className="truncate text-sm font-medium">{project.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{entries.length} queued</span>
                  {free.length > 0 && (
                    <>
                      {/* The project's batch act, said as one: how many agents, then "Start N agents", which starts them from the top. */}
                      <div className="ml-auto">
                        <BatchCount count={count} max={free.length} onChange={next => starts.setCount(project.id, next)} />
                      </div>
                      {/* The chevron sends the top entry alone: a launcher can only ever start one agent. */}
                      <StartAgentButton
                        icon={<FastForward className="h-3.5 w-3.5" aria-hidden />}
                        label={fanOutPress(count)}
                        menuAriaLabel={`Other ways to start agents on ${project.name}'s queue`}
                        tooltip={fanOutLabel(count)}
                        busy={inFlight}
                        starting={starts.fanningOut(project.id)}
                        onStart={() => void starts.fanOutProject(project.id, free)}
                        onConfigure={() => host.configureRun(project.id, workOnEntryPrompt(free[0]!))}
                        prompt={workOnEntryPrompt(free[0]!)}
                        configureDescription="Opens the launcher with the top entry's prompt — one agent, not the batch."
                      />
                    </>
                  )}
                </div>
                {read.error !== undefined && (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    Could not read the queue of {project.name}: {read.error}
                  </p>
                )}
                <ul className="mt-1 pl-0.5">
                  {entries.map((entry, i) => {
                    // A queued link reads as its text, a named file as its name; the whole line stays in the tooltip.
                    const view = entryView(project.id, entry, names)
                    const agent = read.working.find(working => isWorkingOn(working.ask, entry))
                    return (
                      <li key={i} className="group/row -mx-2 flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent">
                        <span aria-hidden className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
                          {i + 1}.
                        </span>
                        <EntryTitle view={view} entry={entry} className={cn('min-w-0 flex-1 truncate text-left max-sm:line-clamp-2 max-sm:whitespace-normal!', (view.open ?? view.url) !== undefined && 'hover:text-foreground hover:underline')} />
                        {/* The agent on the entry, else its start: under the pointer, or with the keyboard on it; a phone has no hover, and there it always shows. */}
                        {agent ? (
                          <AgentOnEntry projectId={project.id} agent={agent} />
                        ) : (
                          <div className="shrink-0 transition-opacity md:opacity-0 md:group-hover/row:opacity-100 md:focus-within:opacity-100 md:has-[[aria-expanded=true]]:opacity-100">
                            <StartAgentButton
                              variant="ghost"
                              size="icon-sm"
                              icon={<Play className="h-3.5 w-3.5" aria-hidden />}
                              ariaLabel="Start an agent working on this entry"
                              menuAriaLabel={`Other ways to run ${view.title}`}
                              tooltip="Start an agent working on this entry"
                              busy={inFlight}
                              starting={starts.starting(project.id, entry)}
                              onStart={() => void starts.startEntry(project.id, entry)}
                              onConfigure={() => host.configureRun(project.id, workOnEntryPrompt(entry))}
                              prompt={workOnEntryPrompt(entry)}
                              configureDescription="Opens the launcher with this entry's prompt, so you can set the model and where it runs."
                              className="text-muted-foreground hover:text-foreground"
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Section>
  )
}
