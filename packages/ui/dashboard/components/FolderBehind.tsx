import { ArrowDownCircle } from 'lucide-react'
import { onFolderBehind, sendUpdateFolder, type FolderBehind } from '../rpc/projects.js'
import { useAction } from '../lib/use-action.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'

// The launcher's line for a project whose folder is behind its remote's main branch (#2421): by how
// many commits, and the press that brings it up, a fast-forward. Nothing when the folder is up to
// date. An agent starts from the remote's branch either way; the folder is what the dashboard reads
// the skills, the commands and the files from, and nothing else updates it.

/** How often the page asks again: the daemon itself asks the remote at most once a minute. */
const EVERY_MS = 60_000

/** `1 commit`, `1,863 commits`. */
function commits(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'commit' : 'commits'}`
}

export function FolderBehindLine({ projectId }: { projectId: string }) {
  const { value: behind, reload } = usePolled<FolderBehind | null>(() => onFolderBehind(projectId), null, EVERY_MS, [projectId])
  const { busy, error, run } = useAction(projectId)
  if (behind === null) return null
  const press = async (): Promise<void> => {
    const outcome = await run(() => sendUpdateFolder(projectId), 'It ended without a word.')
    if (outcome.ok) await reload()
  }
  return (
    <section aria-label="Project folder" className="rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ArrowDownCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          This project’s folder is {commits(behind.behind)} behind {behind.branch}.
        </span>
        {/* Busy, it keeps the focus it was pressed with: a disabled press would drop it to the page. */}
        <Button size="sm" variant="outline" aria-disabled={busy || undefined} className={cn(busy && 'opacity-50')} onClick={() => void (busy || press())}>
          {busy ? 'Updating…' : 'Update folder'}
        </Button>
      </div>
      {error && (
        <div role="alert" className="mt-1 space-y-0.5 text-xs">
          <p className="text-danger">The folder could not be updated. git said:</p>
          <p className="font-mono whitespace-pre-wrap text-muted-foreground">{error}</p>
        </div>
      )}
    </section>
  )
}
