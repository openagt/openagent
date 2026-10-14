import { DiffStat, useModuleHost, usePolled } from '@openagt/dashboard/module'
import type { FileDiff } from '../src/diff.js'
import { readDiff } from './reads.js'
import { DiffView } from './DiffView.js'

/** One changed file's diff under its path and line counts, read from the selected agent's worktree (#815). */
export function DiffCard({ projectId, agentId, path, commit }: {
  projectId: string
  agentId?: string | null | undefined
  path: string
  /** One commit of the run's work: the diff is then what that commit alone changed in the file. */
  commit?: string | undefined
}) {
  // Polled, not read once: the pane is open over a session that is still editing, so the diff
  // keeps up rather than freezing at whatever it was when the file was picked.
  const host = useModuleHost()
  const { value, loaded } = usePolled<FileDiff | null>(() => readDiff(host, projectId, path, agentId ?? undefined, commit), null, 5_000, [projectId, agentId, path, commit])

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{path}</span>
        {value && <DiffStat added={value.added} removed={value.removed} className="ml-auto" />}
      </header>
      {!loaded ? (
        <p className="p-2 text-xs text-muted-foreground">Reading the diff…</p>
      ) : !value ? (
        <p className="p-2 text-xs text-muted-foreground">No change to show.</p>
      ) : (
        <DiffView diff={value} className="py-1" />
      )}
    </>
  )
}
