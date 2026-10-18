'use client'
import { useEffect, useState } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import type { CleanupReport } from '../../src/index.js'
import { sendRemoveProject } from '../rpc/projects.js'
import { useAction } from '../lib/use-action.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Checkbox } from './ui/checkbox.js'

const name = 'font-medium text-foreground'

// "Remove project…", asked first. Removing takes the project off the list and deletes nothing,
// unless the person ticks the box: then OpenAgent's own files in the folder go too, and the dialog
// stays to say what went and what stayed before the page moves on. The box is never ticked for
// them, and what it deletes is said the moment it is ticked, not after.
export function RemoveProjectDialog({
  projectId,
  open,
  onOpenChange,
  onRemoved,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fires once the project is off the list and the dialog has closed: safe to navigate away in. */
  onRemoved: () => void
}) {
  const [files, setFiles] = useState(false)
  const [report, setReport] = useState<CleanupReport | null>(null)
  const { busy, error, run, reset } = useAction()

  // Each time it opens the box is unticked and an old error is gone: the menu opens it from
  // outside, so the dialog is not told through its own open-change.
  useEffect(() => {
    if (!open) return
    setFiles(false)
    reset()
  }, [open, reset])

  const finish = (): void => {
    onOpenChange(false)
    // After the close, so a page that unmounts this does not tear the dialog down mid-transition.
    queueMicrotask(onRemoved)
  }
  const remove = (): void => {
    void run(() => sendRemoveProject(projectId, files), 'Could not remove the project.').then(outcome => {
      if (!outcome.ok) return
      const cleanup = outcome.value.cleanup
      if (cleanup) setReport(cleanup)
      else finish()
    })
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={next => {
        // Never closed while the removal runs, nor past the report: the project is already gone
        // then, and "Done" is the one way on.
        if (busy || report) return
        onOpenChange(next)
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg">
          {report ? (
            <>
              <AlertDialog.Title className="text-sm font-semibold">Project removed</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
                It left the dashboard&rsquo;s list. This is what happened to OpenAgent&rsquo;s files in the folder.
              </AlertDialog.Description>
              <ReportList title="Deleted" empty="Nothing: there was nothing of OpenAgent&rsquo;s to delete." lines={report.removed} />
              {report.kept.length > 0 && <ReportList title="Kept" lines={report.kept.map(kept => `${kept.path}: ${kept.reason}`)} />}
              {report.failed.length > 0 && <ReportList title="Could not be cleaned" lines={report.failed} danger />}
              <div className="mt-4 flex justify-end">
                <Button size="sm" onClick={finish}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <AlertDialog.Title className="text-sm font-semibold">Remove this project?</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
                It leaves the dashboard&rsquo;s list, and its scheduler stops unless you set it to keep running.{' '}
                {files ? (
                  <>Your files and your commits stay.</>
                ) : (
                  <>
                    Nothing in the folder is deleted: your files and your commits stay, and so do OpenAgent&rsquo;s own files there (
                    <span className={name}>.openagent</span>, <span className={name}>.branches</span>,{' '}
                    <span className={name}>.agent-runner</span> and the branch <span className={name}>agent-data</span> with the agents&rsquo;
                    records).
                  </>
                )}{' '}
                Add the folder again to bring the project back.
              </AlertDialog.Description>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-foreground">
                <Checkbox checked={files} onCheckedChange={checked => setFiles(checked === true)} disabled={busy} className="mt-0.5" />
                <span>Also delete OpenAgent&rsquo;s files in this folder</span>
              </label>
              {files && (
                <div className="mt-2 rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground">
                  <p>
                    This deletes, on this machine: the agents&rsquo; checkouts in <span className={name}>.branches</span>, the folders{' '}
                    <span className={name}>.openagent</span> (with <span className={name}>hooks.yml</span>, the project&rsquo;s start lines) and{' '}
                    <span className={name}>.agent-runner</span>, and the local branch <span className={name}>agent-data</span>. A tool that
                    worked in the project removes its own files too: the scheduler&rsquo;s state, the subagent settings.
                  </p>
                  <p className="mt-2">
                    <span className={name}>The agents&rsquo; conversations go with that branch.</span> If you never shared the records, this is
                    their only copy. If you did, what has not reached the remote yet is lost. An agent that waits for your answer cannot be
                    continued after this.
                  </p>
                  <p className="mt-2">
                    It never touches the remote, your files, your commits, a branch with work on it, or a file git tracks. A checkout with
                    uncommitted work stays, and so does <span className={name}>.agent-runner/config.yml</span> if you wrote one. A scheduler
                    you set to keep running is not stopped: its files, the records and <span className={name}>.openagent</span> then stay.
                    Stop it, add the folder again and remove it once more to delete them. You see the list of what went and what stayed right after.
                  </p>
                </div>
              )}
              {error && <p className="mt-2 text-xs text-danger">{error}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <AlertDialog.Close
                  render={
                    <Button variant="outline" size="sm" disabled={busy}>
                      Cancel
                    </Button>
                  }
                />
                <Button variant="destructive" size="sm" disabled={busy} onClick={remove} className={cn(busy && 'cursor-progress')}>
                  {busy ? 'Removing…' : files ? 'Remove and delete' : 'Remove'}
                </Button>
              </div>
            </>
          )}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

function ReportList({ title, lines, empty, danger = false }: { title: string; lines: string[]; empty?: string; danger?: boolean }) {
  return (
    <div className="mt-3 text-xs">
      <p className={cn('font-medium', danger ? 'text-danger' : 'text-foreground')}>{title}</p>
      {lines.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {lines.map(line => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
