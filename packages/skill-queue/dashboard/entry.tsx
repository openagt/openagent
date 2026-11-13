import { Bot } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, pathsIn, useModuleHost, type FileNames, type ModuleAgent } from '@openagt/dashboard/module'
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
}

/** One entry of `projectId`'s queue as the page shows it, by the names the installed pages give the paths in it. */
export function entryView(projectId: string, entry: string, names: FileNames): EntryView {
  const label = entryLabel(entry)
  const linked = label.text !== entry.trim()
  const named = pathsIn(entry)
    .map(path => names(projectId, path))
    .find(name => name !== undefined)
  if (label.url !== undefined) return { title: label.text, url: label.url, renamed: false }
  if (linked) return { title: label.text, ...(named ? { open: named.open } : {}), renamed: false }
  if (named) return { title: named.title, open: named.open, renamed: true }
  return { title: label.text, renamed: false }
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

/** The mark of an entry an agent is working on, which opens that agent: on the Queue page and on the Overview's card alike. */
export function AgentOnEntry({ projectId, agent }: { projectId: string; agent: ModuleAgent }) {
  const host = useModuleHost()
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" onClick={() => host.openAgent(projectId, agent.id)} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success hover:underline" />}
      >
        <Bot className="h-3 w-3" aria-hidden />
        <span className="max-md:sr-only">An agent is on it</span>
      </TooltipTrigger>
      <TooltipContent>An agent is working on this entry: open it</TooltipContent>
    </Tooltip>
  )
}
