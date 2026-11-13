'use client'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import { cn } from '../../lib/utils.js'
import { buttonVariants } from './button.js'

// The shadcn "base" dialog (Base UI, not Radix) — a centered modal shell for a small form (#1025).
// Unlike ConfirmDialog (AlertDialog, focus-trapped and no light-dismiss, for the one irreversible
// action), this is a plain Dialog: Esc and a backdrop click close it, since a half-filled form is
// not a commit you have to defend against. Controlled by the caller (`open`/`onOpenChange`), so the
// host owns when it shows; the header carries a title and a close affordance.
//
// A long form is `wide`, scrolls inside the dialog under its title, and keeps its presses in
// `footer`, always in view; with much typed into it, `keepOnOutsidePress` leaves a click beside it
// without effect, so only its own presses and Esc close it.
//
// A field the dialog opens on is `initialFocus`, never `autoFocus`: React focuses an `autoFocus`
// field before Base UI notes the press that opened the dialog, which it gives the focus back to.

/** The dim behind a dialog, which fades in and out with it. */
export const BACKDROP_CLASS =
  'fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] transition-opacity duration-180 data-[ending-style]:duration-120 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'

/**
 * Where a dialog stands: in the window's middle, grown in 180ms and gone in 120ms; on a phone, a
 * sheet from the bottom edge, as wide as the screen, so a long form and the keyboard leave its
 * presses within the thumb's reach.
 */
export const DIALOG_POPUP_CLASS = cn(
  'fixed z-50 flex flex-col border border-hairline bg-card text-card-foreground shadow-lg outline-none',
  'md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:p-5',
  'max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[calc(100dvh-1rem)] max-md:rounded-t-lg max-md:px-4 max-md:pt-4 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]',
  'transition-[opacity,scale,translate] duration-180 data-[ending-style]:duration-120 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
  'md:data-[starting-style]:scale-97 md:data-[ending-style]:scale-97 max-md:data-[starting-style]:translate-y-8 max-md:data-[ending-style]:translate-y-8',
)

/** Around a dialog's presses: 44 high on a phone, under the thumb. */
export const DIALOG_PRESSES_CLASS = 'max-md:[&_button]:h-11'

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  wide = false,
  keepOnOutsidePress = false,
  initialFocus,
  finalFocus,
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
  /** The field that has the focus once it opens; else, or while that field is disabled, the first thing in it that takes the focus. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Where the focus goes once it closes, for a dialog whose press is gone by then (a menu's item); else the press that opened it. */
  finalFocus?: RefObject<HTMLElement | null>
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange} disablePointerDismissal={keepOnOutsidePress}>
      <BaseDialog.Portal>
        {/* Drawn over another dialog too (Settings), which Base UI leaves undimmed unless told. */}
        <BaseDialog.Backdrop forceRender className={BACKDROP_CLASS} />
        <BaseDialog.Popup
          initialFocus={initialFocus && (() => (initialFocus.current?.matches(':enabled') ? initialFocus.current : true))}
          {...(finalFocus ? { finalFocus } : {})}
          className={cn(DIALOG_POPUP_CLASS, wide ? 'md:w-[min(46rem,calc(100vw-2rem))]' : 'md:w-[min(34rem,calc(100vw-2rem))]')}
        >
          <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
            <BaseDialog.Title className="text-base font-semibold">{title}</BaseDialog.Title>
            <BaseDialog.Close
              aria-label="Close"
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-my-1 -mr-1 text-muted-foreground hover:text-foreground')}
            >
              <X className="size-4" aria-hidden />
            </BaseDialog.Close>
          </div>
          {/* What scrolls when the form is taller than the window; the room at its sides keeps a field's focus ring whole. */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{children}</div>
          {footer !== undefined && <div className={cn('mt-4 shrink-0', DIALOG_PRESSES_CLASS)}>{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
