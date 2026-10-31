'use client'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ComponentProps } from 'react'
import { cn } from '@openagt/skill-ui/module'

// A shadcn "sheet" on Base UI's Dialog (no Radix): an edge-anchored drawer. The sidebar uses it as
// its mobile presentation (off-canvas), the same job Radix's Sheet does upstream. Controlled by the
// caller via `open`/`onOpenChange` on the Root.

function Sheet(props: ComponentProps<typeof BaseDialog.Root>) {
  return <BaseDialog.Root {...props} />
}

function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: ComponentProps<typeof BaseDialog.Popup> & { side?: 'left' | 'right' }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
      <BaseDialog.Popup
        className={cn(
          'fixed inset-y-0 z-50 flex h-full w-3/4 max-w-sm flex-col bg-card text-card-foreground shadow-lg outline-none',
          side === 'left' ? 'left-0 border-r border-border' : 'right-0 border-l border-border',
          className,
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-1 p-4', className)} {...props} />
}

function SheetTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn('text-sm font-semibold', className)} {...props} />
}

function SheetDescription({ className, ...props }: ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription }
