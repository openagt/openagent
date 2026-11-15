import { FastForward, Play } from 'lucide-react'
import { PageLink, Panel, PanelGroup, PanelNote, PanelRow, PartDescription, SentenceShape, Slot, StartAgentButton, pathsIn, useFileNames, useModuleHost, type ModuleCardProps } from '@openagt/dashboard/module'
import { fanOutLabel, fanOutPress, unclaimedEntries, workOnEntryPrompt } from '../src/module.js'
import { EntryTitle, entryView } from './entry.js'
import { useQueueStarts, type QueueStarts } from './starts.js'
import { BatchCount } from './batch-count.js'
import { useQueueReads, type ProjectRead } from './reads.js'

// The Overview's Up next card: in each project with open entries, the first entries no agent is on,
// the work agents pick up next, numbered by their place in the queue; at its heading a link to the
// Queue page that says how many wait, where an entry is also removed and added. An entry an agent is on is at
// work, and the At work part lists it. Its data is `queue --local` in each project, the very list an
// agent reads. An entry that names a file another page opens reads as that page's name for it (a
// ticket's title).
//
// Two ways to act, and they are different acts. The play button beside an entry STARTS it: one
// agent, on that entry alone, and the dashboard lands on the run. The project's batch act, at the
// card's heading (at the project's own with several), is a fan-out that starts one agent per top
// entry, as many as the count beside it says, each pinned to its own entry, without leaving the
// Overview. Both are split buttons: the chevron beside each hands its prompt to the project's
// launcher instead of spending an agent on the settings the card cannot show.

/** How many of a project's free entries the card shows: the next few, the rest on the Queue page. */
const SHOWN = 3

export function QueueCard({ projects }: ModuleCardProps) {
  const host = useModuleHost()
  const { reads, state } = useQueueReads(projects)
  const starts = useQueueStarts(host)
  const names = useFileNames(reads.map(read => ({ projectId: read.project.id, paths: read.entries.flatMap(pathsIn) })))
  const { inFlight, error } = starts

  const shown = reads.filter(read => read.entries.length > 0 || read.error !== undefined)
  // With one project, its batch act is the card's own, at its heading, before the way to the whole queue.
  const single = shown.length === 1 ? shown[0] : undefined
  const waiting = shown.reduce((sum, read) => sum + unclaimedEntries(read.entries, read.working).length, 0)
  return (
    <PanelGroup
      bare
      title="Up next"
      action={
        <>
          {single && <BatchStart read={single} starts={starts} />}
          {state !== 'unknown' && shown.length > 0 && (
            <PageLink href={host.pageHref('queue')} onOpen={() => host.openPage('queue')}>
              All {waiting} waiting
            </PageLink>
          )}
        </>
      }
    >
      <PartDescription>Tasks AI will work on next</PartDescription>
      <Slot of={{ state, value: shown }} shape={<SentenceShape />}>
        {() =>
          shown.length === 0 ? (
            <Panel>
              <PanelNote>Nothing queued.</PanelNote>
            </Panel>
          ) : (
            <ul className="space-y-4">
              {shown.map(read => {
                const { project, entries } = read
                // An entry an agent is on is at work: up next are the others, from the top.
                const free = unclaimedEntries(entries, read.working)
                return (
                  <li key={project.id}>
                    {/* Over several projects, each is named; its batch act stands beside its name unless it is the card's. */}
                    {projects.length > 1 && (
                      <div className="mb-2 flex min-h-8 w-full items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
                        {!single && <BatchStart read={read} starts={starts} />}
                      </div>
                    )}
                    {read.error !== undefined && (
                      <p role="alert" className="mb-2 text-xs text-danger">
                        Could not read the queue of {project.name}: {read.error}
                      </p>
                    )}
                    {entries.length > 0 && (
                      <Panel>
                        {free.length === 0 && <PanelNote>An agent is on every entry.</PanelNote>}
                        {free.slice(0, SHOWN).map(entry => {
                          // A queued link reads as its text, a named file as its name; the whole line stays in the tooltip.
                          const view = entryView(project.id, entry, names)
                          return (
                            <PanelRow
                              key={entry}
                              // Its place in the queue: the order agents take the entries in.
                              state={<span className="text-xs tabular-nums text-faint-foreground">{entries.indexOf(entry) + 1}.</span>}
                              title={<EntryTitle view={view} entry={entry} {...((view.open ?? view.url) !== undefined ? { className: 'relative hover:underline' } : {})} />}
                              actions={
                                // Pulled out by its chevron's own padding, so the glyph ends on the row's inset.
                                <span className="-mr-1.5 flex">
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
                                </span>
                              }
                            />
                          )
                        })}
                      </Panel>
                    )}
                  </li>
                )
              })}
            </ul>
          )
        }
      </Slot>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </PanelGroup>
  )
}

/** A project's batch act, said as one: how many agents, then "Start N agents", which starts them from the top of the free entries. The chevron sends the top entry alone: a launcher can only ever start one agent. */
function BatchStart({ read, starts }: { read: ProjectRead; starts: QueueStarts }) {
  const host = useModuleHost()
  const free = unclaimedEntries(read.entries, read.working)
  if (free.length === 0) return null
  const { project } = read
  const count = starts.batchOf(project.id, free)
  return (
    <>
      <BatchCount count={count} max={free.length} onChange={next => starts.setCount(project.id, next)} className="h-7" />
      <StartAgentButton
        icon={<FastForward className="h-3.5 w-3.5" aria-hidden />}
        label={fanOutPress(count)}
        menuAriaLabel={`Other ways to start agents on ${project.name}'s queue`}
        tooltip={fanOutLabel(count)}
        busy={starts.inFlight}
        starting={starts.fanningOut(project.id)}
        onStart={() => void starts.fanOutProject(project.id, free)}
        onConfigure={() => host.configureRun(project.id, workOnEntryPrompt(free[0]!))}
        prompt={workOnEntryPrompt(free[0]!)}
        configureDescription="Opens the launcher with the top entry's prompt — one agent, not the batch."
      />
    </>
  )
}
