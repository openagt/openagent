'use client'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import type { CleanupReport } from '../../src/index.js'
import { sendRemoveProject } from '../rpc/projects.js'
import { ProjectLabelsContext } from '../lib/project-labels.js'
import { useMountedModules } from '../lib/use-modules.js'
import { useAction } from '../lib/use-action.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Checkbox } from './ui/checkbox.js'
import { BACKDROP_CLASS, DIALOG_POPUP_CLASS, DIALOG_PRESSES_CLASS } from './ui/dialog.js'

const name = 'font-medium text-foreground'
/** The question and its report alike: the dialog every question has, its own width on a wide screen. */
const POPUP = cn(DIALOG_POPUP_CLASS, 'overflow-y-auto md:w-[min(28rem,calc(100vw-2rem))]')

// "Remove project…", asked first. Removing takes the project off the list and deletes nothing,
// unless the person ticks the box: then OpenAgent's own files in the folder go too. Either way the
// page leaves the project's address as soon as it is off the list, and `ProjectRemovedReport` says it
// is done over the page it moved on to, with the box ticked what went and what stayed. The box is
// never ticked for them, and what it deletes is said the moment it is ticked, not after.
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
  const { busy, error, run, reset } = useAction()
  const sayRemoved = useContext(SayRemovedContext)
  // It opens on Cancel, as the other confirmations do, never on the box that widens the deletion.
  const cancel = useRef<HTMLButtonElement>(null)
  const label = useContext(ProjectLabelsContext).get(projectId)
  // Only a project that has the scheduler has one to stop.
  const scheduled = useMountedModules().views['app.page'].some(page => page.package === '@openagt/skill-scheduler' && page.projects.includes(projectId))

  // Each time it opens the box is unticked and an old error is gone: the menu opens it from
  // outside, so the dialog is not told through its own open-change.
  useEffect(() => {
    if (!open) return
    setFiles(false)
    reset()
  }, [open, reset])

  const remove = (): void => {
    void run(() => sendRemoveProject(projectId, files), 'Could not remove the project.').then(outcome => {
      if (!outcome.ok) return
      const cleanup = outcome.value.cleanup
      sayRemoved(cleanup ? { report: cleanup } : {})
      onOpenChange(false)
      // After the close, so a page that unmounts this does not tear the dialog down mid-transition.
      queueMicrotask(onRemoved)
    })
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={next => {
        // Never closed while the removal runs.
        if (busy) return
        onOpenChange(next)
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={BACKDROP_CLASS} />
        <AlertDialog.Popup data-overlay="question" initialFocus={cancel} className={POPUP}>
          <AlertDialog.Title className="text-base font-semibold">{label ? `Remove the project ${label}?` : 'Remove this project?'}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            It leaves the dashboard&rsquo;s list{scheduled && <>, and its scheduler stops unless you set it to keep running</>}.{' '}
            {files ? (
              <>Your files and your commits stay.</>
            ) : (
              <>
                Nothing in the folder is deleted: your files and your commits stay, and so do OpenAgent&rsquo;s own files there (
                <span className={name}>.openagent</span>, <span className={name}>.branches</span>,{' '}
                <span className={name}>.agent-runner</span>), and the agents&rsquo; records (in <span className={name}>~/.openagent</span>,
                or on the branch <span className={name}>agent-data</span> if you shared them).
              </>
            )}{' '}
            Add the folder again to bring the project back.
          </AlertDialog.Description>
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-foreground">
            <Checkbox checked={files} onCheckedChange={checked => setFiles(checked === true)} disabled={busy} className="mt-0.5" />
            <span>Also delete OpenAgent&rsquo;s files in this folder</span>
          </label>
          {files && (
            // 12 at its sides; 8 above and under, which the lines' leading brings to the sides' 12.
            <div className="mt-3 rounded-md border border-hairline px-3 py-2 text-sm text-muted-foreground">
              {/* What it comes to first, on a line of its own; what it deletes under it. */}
              <p className="text-foreground">This deletes, on this machine:</p>
              <p className="mt-1">
                the agents&rsquo; checkouts in <span className={name}>.branches</span>, the folders{' '}
                <span className={name}>.openagent</span> (with <span className={name}>hooks.yml</span>, the lines run as the dashboard opens and closes) and{' '}
                <span className={name}>.agent-runner</span>, the agents&rsquo; records in <span className={name}>~/.openagent</span>, and the
                local branch <span className={name}>agent-data</span>. A tool that
                worked in the project removes its own files too: the scheduler&rsquo;s state, the subagent settings.
              </p>
              <p className="mt-2">
                <span className={name}>The agents&rsquo; conversations go with them.</span> If you never shared the records, this is
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
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          <div className={cn('mt-6 flex justify-end gap-2', DIALOG_PRESSES_CLASS)}>
            <AlertDialog.Close
              ref={cancel}
              render={
                <Button variant="ghost" disabled={busy}>
                  Cancel
                </Button>
              }
            />
            <Button variant="destructive" loading={busy} onClick={remove}>
              {busy ? 'Removing…' : files ? 'Remove and delete' : 'Remove'}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

type Removed = { report?: CleanupReport }
const SayRemovedContext = createContext<(removed: Removed) => void>(() => {})

/**
 * "Project removed", around the shell: the project's own page, and the menu that asked, go with the
 * project, so what the removal did is said over the page the shell moved on to, until Done. With the
 * box ticked, what happened to OpenAgent's files in the folder.
 */
export function ProjectRemovedReport({ children }: { children: ReactNode }) {
  const [removed, setRemoved] = useState<Removed | null>(null)
  const done = useRef<HTMLButtonElement>(null)
  const report = removed?.report
  return (
    <SayRemovedContext.Provider value={setRemoved}>
      {children}
      <AlertDialog.Root open={removed !== null} onOpenChange={open => open || setRemoved(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={BACKDROP_CLASS} />
          {/* The menu that opened the question is gone with the project: the project picker, where the next project is picked, takes the focus. */}
          <AlertDialog.Popup data-overlay="question" initialFocus={done} finalFocus={() => document.querySelector<HTMLElement>('[data-project-picker]')} className={POPUP}>
            <AlertDialog.Title className="text-base font-semibold">Project removed</AlertDialog.Title>
            {report ? (
              <>
                <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
                  It left the dashboard&rsquo;s list. This is what happened to OpenAgent&rsquo;s files in the folder.
                </AlertDialog.Description>
                <ReportList title="Deleted" empty="Nothing: there was nothing of OpenAgent&rsquo;s to delete." lines={report.removed} />
                {report.kept.length > 0 && <ReportList title="Kept" lines={report.kept.map(kept => `${kept.path}: ${kept.reason}`)} />}
                {report.failed.length > 0 && <ReportList title="Could not be cleaned" lines={report.failed} danger />}
              </>
            ) : (
              <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
                It left the dashboard&rsquo;s list, and nothing in the folder was deleted. Add the folder again to bring the project back.
              </AlertDialog.Description>
            )}
            <div className={cn('mt-6 flex justify-end', DIALOG_PRESSES_CLASS)}>
              <AlertDialog.Close ref={done} render={<Button>Done</Button>} />
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </SayRemovedContext.Provider>
  )
}

function ReportList({ title, lines, empty, danger = false }: { title: string; lines: string[]; empty?: string; danger?: boolean }) {
  return (
    <div className="mt-4 text-sm">
      <p className={cn('font-medium', danger ? 'text-danger' : 'text-foreground')}>{title}</p>
      {lines.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-1 font-mono text-xs text-muted-foreground">
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
