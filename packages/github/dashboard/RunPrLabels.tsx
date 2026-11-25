import { GitPullRequest } from 'lucide-react'
import { PR_MARKS, Tooltip, TooltipContent, TooltipTrigger, cn, prStateOf, useModuleHost, usePolled, type UiChatLabelsProps } from '@openagt/ui/module'
import { server } from './calls.js'

/** How often a run's requests are read again while its page shows: a merge on GitHub changes their marks. */
const EVERY_MS = 15_000

/** The run's pull requests, at the end of the row above its message box (`chat.labels`), read from its record and GitHub. */
export function RunPrs({ projectId, agentId }: UiChatLabelsProps) {
  const host = useModuleHost()
  const { value } = usePolled(() => server(host).runPrs(projectId, { agentId }), [], EVERY_MS, [projectId, agentId], { remember: `github:prs:${projectId}:${agentId}` })
  return <RunPrLabels prs={value} />
}

/**
 * The run's pull requests, at the right end of the row above its message box, the last one ending
 * on the box's edge: one label each (his pick), oldest first, its mark in GitHub's colour for how
 * it stands, as its row in the sidebar marks it, and its number; a link to the request. The
 * state's word is in the label's hover and its name, not drawn. A run that moved its work to a new
 * branch opened a request for each, and all of them are its work. A state not read yet is a plain mark.
 */
export function RunPrLabels({ prs }: { prs: readonly { number: number; url: string; state?: string | undefined }[] }) {
  if (prs.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {prs.map(pr => {
        const state = pr.state === undefined ? undefined : prStateOf(pr.state)
        const mark = state ? PR_MARKS[state] : undefined
        const Icon = mark?.Icon ?? GitPullRequest
        return (
          <Tooltip key={pr.url}>
            <TooltipTrigger
              render={
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`PR #${pr.number}${mark ? ` ${mark.word}` : ''}, on GitHub`}
                  className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                />
              }
            >
              <Icon className={cn('size-3.5 shrink-0', mark?.tone)} aria-hidden />
              <span className="tabular-nums text-foreground">#{pr.number}</span>
            </TooltipTrigger>
            <TooltipContent>{`PR #${pr.number}${mark ? `, ${mark.word}` : ''}`}</TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}
