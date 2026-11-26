import type { ComponentType, ReactNode } from 'react'
import type { PullRequestState } from '@openagt/hooks'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'

// The rows of a session's Activity panel (ActivityPanel), which the modules draw theirs with too.

/**
 * A row of the Environment, as Claude Code's: its icon, what it names, and at its end what it
 * offers. Its hover says what the row is (`title`) and lights it.
 */
export function EnvironmentRow({ icon: Icon, title, end, children }: { icon: ComponentType<{ className?: string }>; title?: ReactNode; end?: ReactNode; children: ReactNode }) {
  const row = (
    <div className="-mx-1.5 flex h-8 min-w-0 items-center gap-3 rounded-md px-1.5 text-sm hover:bg-accent">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {end}
    </div>
  )
  if (title === undefined) return row
  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipContent className="whitespace-pre-line">{title}</TooltipContent>
    </Tooltip>
  )
}

/** A repository's address as Claude Code names a repo: its path without the host (`me/shop`). */
export function repoPath(address: string): string {
  const at = address.indexOf('/')
  return at < 0 ? address : address.slice(at + 1)
}

/** The pull request's mark's colour, by how it stands: open as Claude Code's green, merged purple, closed red; a draft, or one not read yet, grey. */
export const prTone = (state: PullRequestState | undefined): string => (state === 'merged' ? 'text-merged' : state === 'closed' ? 'text-danger' : state === 'open' ? 'text-success' : 'text-muted-foreground')

