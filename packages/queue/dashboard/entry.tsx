import { Tooltip, TooltipContent, TooltipTrigger, cn, formatDuration, pathsIn, useModuleHost, type FileNames, type ModuleAgent } from '@openagt/ui/module'
import { entryLabel } from '../src/module.js'

// How one queue entry reads, on the Queue page and on the Overview's card alike. An entry is a
// line of text: a queued link (`[title](target)`) reads as its title; a line that names a file of
// the project another page opens (`Create tickets/2026-01-01_x.plan.md`) reads as that page's name
// for it, the ticket's title, and opens that page; anything else reads as it is written.

/** What to show for one entry, and what a click on it opens, if anything. */
export interface EntryView {
  /** The words a person reads. */
  title: string
  /** An address the title opens in a new tab: a queued link to a web page. */
  url?: string
  /** Open the dashboard page that shows what the entry names. */
  open?: () => void
  /** Whether the title stands in for the line as written: the line is then worth showing too. */
  renamed: boolean
  /** Whether the entry is, word for word, the ask for what is there already (a plan already written): left over, no work for an agent. */
  done: boolean
}

/** One entry of `projectId`'s queue as the page shows it, by the names the installed pages give the paths in it. */
export function entryView(projectId: string, entry: string, names: FileNames): EntryView {
  const label = entryLabel(entry)
  const linked = label.text !== entry.trim()
  const named = pathsIn(entry)
    .map(path => names(projectId, path))
    .find(name => name !== undefined)
  // Only the entry that is left over is called by what is there already ("already written"): any other naming the path is still work.
  const leftOver = named?.done?.ask === entry.trim() ? named.done : undefined
  const done = leftOver !== undefined
  if (label.url !== undefined) return { title: label.text, url: label.url, renamed: false, done }
  if (linked) return { title: label.text, ...(named ? { open: named.open } : {}), renamed: false, done }
  if (named) return { title: leftOver?.title ?? named.title, open: named.open, renamed: true, done }
  return { title: label.text, renamed: false, done }
}

/** An entry's title, as a link where it opens something. The whole line is its tooltip. */
export function EntryTitle({ view, entry, className }: { view: EntryView; entry: string; className?: string }) {
  if (view.url !== undefined)
    return (
      <a href={view.url} target="_blank" rel="noreferrer" className={className ?? 'min-w-0 truncate hover:underline'} title={entry}>
        {view.title}
      </a>
    )
  if (view.open)
    return (
      <button type="button" onClick={view.open} className={className ?? 'min-w-0 truncate text-left hover:underline'} title={entry}>
        {view.title}
      </button>
    )
  return (
    <span className={className ?? 'min-w-0 truncate'} title={entry}>
      {view.title}
    </span>
  )
}

/**
 * Who is on an entry, said in its row and opening that agent: on the Queue page and on the Overview's
 * card alike. An agent at work in the working colour, one waiting on the person's answer in the
 * colour of what waits on you, each with how long it has been on it.
 */
export function AgentOnEntry({ projectId, agent }: { projectId: string; agent: ModuleAgent }) {
  const host = useModuleHost()
  const asking = agent.status === 'waiting'
  const since = Date.parse(agent.startedAt)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => host.openAgent(projectId, agent.id)}
            className={cn('focus-ring relative z-10 inline-flex shrink-0 items-center rounded-sm font-medium hover:underline', asking ? 'text-warning' : 'text-info')}
          />
        }
      >
        {asking ? 'Waiting on you' : 'An agent is on it'}
        {Number.isFinite(since) && ` · ${formatDuration(Date.now() - since)}`}
      </TooltipTrigger>
      <TooltipContent>{asking ? 'The agent on this entry asks you something: open it' : 'An agent is working on this entry: open it'}</TooltipContent>
    </Tooltip>
  )
}
