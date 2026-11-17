'use client'
import * as React from 'react'
import { flushSync } from 'react-dom'
import { useRender } from '@base-ui/react/use-render'

import { cn } from '../../lib/utils.js'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet.js'
import { useIsMobile } from '../../lib/use-mobile.js'
import { pressed, useShortcut } from '../../lib/shortcut.js'

// shadcn's "base" (Base UI, not Radix) Sidebar, ported to this repo (#314 rail, shared shell), and
// kept to the parts the shell draws: a column of the page from md up, a sheet on a phone. The mobile
// branch does not forward the wrapper's div props onto the Sheet's Dialog root. `--sidebar-*` tokens
// live in tailwind.css.

const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_WIDTH_MOBILE = '18rem'

type SidebarContextProps = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.')
  }
  return context
}

/** The sidebar's state, or null outside a SidebarProvider: for a part drawn in the shell and also alone (a module's page in its own tests). */
function useOptionalSidebar() {
  return React.useContext(SidebarContext)
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // Internal open state; open/onOpenChange let a host control it from outside.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }
    },
    [setOpenProp, open],
  )

  // By its button or its key: the keyboard in what goes, the sidebar or the pressed button, or on
  // nothing (a press that took no focus), goes to the button drawn in its place. A phone's sheet
  // gives it back to its opener itself.
  const toggleSidebar = React.useCallback(() => {
    if (isMobile) return setOpenMobile(prev => !prev)
    const at = document.activeElement
    const goes = !at || at === document.body || at.closest('[data-slot="sidebar"], [data-sidebar-toggle]')
    flushSync(() => setOpen(prev => !prev))
    if (goes) document.querySelector<HTMLElement>('[data-sidebar-toggle]')?.focus()
  }, [isMobile, setOpen, setOpenMobile])

  useShortcut('sidebar', toggleSidebar)

  // A data-state to drive the Tailwind styling (`data-state="expanded" | "collapsed"`).
  const state = open ? 'expanded' : 'collapsed'

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            '--sidebar-width': SIDEBAR_WIDTH,
            ...style,
          } as React.CSSProperties
        }
        className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

/** The sidebar: a column of the page from md up, and on a phone a sheet over it, closed until asked for. */
function Sidebar({ side = 'left', className, children, ...props }: React.ComponentProps<'div'> & { side?: 'left' | 'right' }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar()

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0"
          style={{ '--sidebar-width': SIDEBAR_WIDTH_MOBILE } as React.CSSProperties}
          side={side}
          // The key that opened it closes it: over the page, the page's keys wait.
          onKeyDown={event => {
            if (!pressed(event, 'sidebar')) return
            event.preventDefault()
            setOpenMobile(false)
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div data-slot="sidebar" className={cn('bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col border-r border-sidebar-border', className)} {...props}>
      {children}
    </div>
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-header" data-sidebar="header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-footer" data-sidebar="footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-content" data-sidebar="content" className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto', className)} {...props} />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-group" data-sidebar="group" className={cn('relative flex w-full min-w-0 flex-col p-2', className)} {...props} />
  )
}

function SidebarGroupLabel({
  className,
  render = <div />,
  ...props
}: React.ComponentProps<'div'> & { render?: useRender.RenderProp }) {
  return useRender({
    render,
    props: {
      'data-slot': 'sidebar-group-label',
      'data-sidebar': 'group-label',
      className: cn('text-muted-foreground flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden [&>svg]:size-4 [&>svg]:shrink-0', className),
      ...props,
    },
  })
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-group-content" data-sidebar="group-content" className={cn('w-full text-sm', className)} {...props} />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul data-slot="sidebar-menu" data-sidebar="menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className={cn('group/menu-item relative', className)} {...props} />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
  useOptionalSidebar,
}
