import { GitPullRequest } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { PR_MARKS, prStateOf } from '../lib/pr-marks.js'
import { rowButtonClass } from './ui/row-item.js'

/**
 * The run's pull request, in the row under its message box (his pick): its number and how it
 * stands, in the git host's colours as its row in the sidebar marks it, a link to the request.
 * A run whose request merged has no bar above the box any more, and this is where its number stays
 * in reach. A state not read yet is a plain mark and no word.
 */
export function RunPrLink({ pr }: { pr: { number: number; url: string; state: string } }) {
  const state = prStateOf(pr.state)
  const mark = state ? PR_MARKS[state] : undefined
  const Icon = mark?.Icon ?? GitPullRequest
  const said = `PR #${pr.number}${mark ? ` ${mark.word}` : ''}`
  return (
    <a href={pr.url} target="_blank" rel="noreferrer" aria-label={`${said}, on the git host`} className={rowButtonClass}>
      <Icon className={cn('h-3.5 w-3.5 shrink-0', mark?.tone)} aria-hidden />
      <span className="truncate">{said}</span>
    </a>
  )
}
