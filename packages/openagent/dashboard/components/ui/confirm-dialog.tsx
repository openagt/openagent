'use client'
import { useState, type ReactNode } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { useAction } from '../../lib/use-action.js'
import { Button, cn } from '@openagt/skill-ui/module'

// A confirm-before-you-act dialog on Base UI's AlertDialog (#1032): for the one action that cannot
// be taken back. The trigger is whatever the caller renders; confirming runs `onConfirm` through
// useAction, so it disables + shows a busy label and surfaces a failure in place instead of
// closing on a silent error. The dialog stays open until the action succeeds.
//
// AlertDialog rather than Dialog on purpose: it traps focus and has no light-dismiss, so a
// destructive confirm is a deliberate choice, not something a stray click past the edge triggers.
export function ConfirmDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  body,
  confirmLabel,
  confirmBusyLabel = 'Working…',
  onConfirm,
  onSuccess,
  fallbackError = 'Something went wrong.',
  destructive = true,
}: {
  /** The control that opens the dialog (an icon button). Omit when driving `open` yourself — e.g.
   *  opening from a menu item, where the menu closes on click and cannot also be the trigger. */
  trigger?: ReactNode
  /** Controlled open state. Given, the dialog is opened/closed by the caller instead of its trigger. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: ReactNode
  /** The consequence, said plainly — this is where the caveats live. */
  body: ReactNode
  confirmLabel: string
  confirmBusyLabel?: string
  /** Runs on confirm; a refused or thrown result keeps the dialog open with the error. */
  onConfirm: () => Promise<unknown>
  /** Fires once, after the dialog has closed on a successful confirm — safe to navigate away in. */
  onSuccess?: () => void
  fallbackError?: string
  destructive?: boolean
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const { busy, error, run, reset } = useAction()

  const confirm = (): void => {
    void run(onConfirm, fallbackError).then(outcome => {
      if (!outcome.ok) return
      setOpen(false)
      // After the close, so a caller that unmounts this (navigating off the deleted session) does
      // not tear the dialog down mid-transition.
      queueMicrotask(() => onSuccess?.())
    })
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={next => {
        // Never close while the action is in flight, and clear a prior error on reopen.
        if (busy) return
        setOpen(next)
        if (next) reset()
      }}
    >
      {trigger && <AlertDialog.Trigger render={trigger as never} />}
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg">
          <AlertDialog.Title className="text-sm font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {body}
          </AlertDialog.Description>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Close
              render={
                <Button variant="outline" size="sm" disabled={busy}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              disabled={busy}
              onClick={confirm}
              className={cn(busy && 'cursor-progress')}
            >
              {busy ? confirmBusyLabel : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
