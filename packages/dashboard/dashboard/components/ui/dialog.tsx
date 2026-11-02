'use client'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

// The shadcn "base" dialog (Base UI, not Radix) — a centered modal shell for a small form (#1025).
// Unlike ConfirmDialog (AlertDialog, focus-trapped and no light-dismiss, for the one irreversible
// action), this is a plain Dialog: Esc and a backdrop click close it, since a half-filled form is
// not a commit you have to defend against. Controlled by the caller (`open`/`onOpenChange`), so the
// host owns when it shows; the header carries a title and a close affordance.

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <BaseDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg outline-none">
          <div className="mb-3 flex items-center justify-between">
            <BaseDialog.Title className="text-sm font-semibold">{title}</BaseDialog.Title>
            <BaseDialog.Close
              aria-label="Close"
              className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </BaseDialog.Close>
          </div>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
