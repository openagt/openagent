import { GitPullRequest } from 'lucide-react'
import { cn } from '@openagt/skill-ui/module'
import { PR_MARKS, prStateOf } from '../lib/pr-marks.js'

/**
 * The run's pull requests, in the row under its message box: one label each (his pick), oldest
 * first, its number and how it stands in the git host's colours as its row in the sidebar marks it,
 * a link to the request. A run that moved its work to a new branch opened a request for each, and
 * all of them are its work. A state not read yet is a plain mark and no word.
 */
export function RunPrLabels({ prs }: { prs: readonly { number: number; url: string; state?: string | undefined }[] }) {
  if (prs.length === 0) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 max-sm:shrink-0">
      {prs.map(pr => {
        const state = pr.state === undefined ? undefined : prStateOf(pr.state)
        const mark = state ? PR_MARKS[state] : undefined
        const Icon = mark?.Icon ?? GitPullRequest
        return (
          <a
            key={pr.url}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`PR #${pr.number}${mark ? ` ${mark.word}` : ''}, on the git host`}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Icon className={cn('h-3 w-3 shrink-0', mark?.tone)} aria-hidden />
            <span className="tabular-nums text-foreground">#{pr.number}</span>
            {mark && <span>{mark.word}</span>}
          </a>
        )
      })}
    </span>
  )
}
