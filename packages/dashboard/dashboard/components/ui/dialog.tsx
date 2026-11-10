'use client'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

// The shadcn "base" dialog (Base UI, not Radix) — a centered modal shell for a small form (#1025).
// Unlike ConfirmDialog (AlertDialog, focus-trapped and no light-dismiss, for the one irreversible
// action), this is a plain Dialog: Esc and a backdrop click close it, since a half-filled form is
// not a commit you have to defend against. Controlled by the caller (`open`/`onOpenChange`), so the
// host owns when it shows; the header carries a title and a close affordance.
//
// A long form is `wide`, scrolls inside the dialog under its title, and keeps its presses in
// `footer`, always in view; with much typed into it, `keepOnOutsidePress` leaves a click beside it
// without effect, so only its own presses and Esc close it.

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  wide = false,
  keepOnOutsidePress = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  /** The dialog's presses, under what scrolls. */
  footer?: ReactNode
  /** Room for a form with several parts. */
  wide?: boolean
  /** A click outside closes nothing. */
  keepOnOutsidePress?: boolean
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange} disablePointerDismissal={keepOnOutsidePress}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <BaseDialog.Popup
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg outline-none',
            wide ? 'w-[min(46rem,calc(100vw-2rem))]' : 'w-[min(34rem,calc(100vw-2rem))]',
          )}
        >
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <BaseDialog.Title className="text-sm font-semibold">{title}</BaseDialog.Title>
            <BaseDialog.Close
              aria-label="Close"
              className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </BaseDialog.Close>
          </div>
          {/* What scrolls when the form is taller than the window; the room at its sides keeps a field's focus ring whole. */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{children}</div>
          {footer !== undefined && <div className="shrink-0 border-t border-border pt-3">{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
