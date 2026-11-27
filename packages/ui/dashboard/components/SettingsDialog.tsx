import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { ArrowLeft, Blocks, ChevronRight, ChevronsUpDown, Keyboard, Layers, Palette, Users, X } from 'lucide-react'
import type { ProjectSummary } from '../../src/index.js'
import { DEFAULT_ORDER, useMountedModules, type MountedView } from '../lib/use-modules.js'

import { useIsMobile } from '../lib/use-mobile.js'
import { AppearanceSettings } from './AppearanceSettings.js'
import { TEAM_ENTRY, TeamSettings } from './TeamSettings.js'
import { SHORTCUTS_ENTRY, ShortcutList } from './ShortcutList.js'
import { PickProject } from './PickProject.js'
import { ProjectDot } from './SidebarProject.js'
import { COMPUTER_PLUGINS_ENTRY, ComputerPluginsSettings, PLUGINS_ENTRY, ProjectPluginsSettings } from './PluginsSettings.js'
import { ModuleSlot, projectsHaving } from './ModulePageView.js'
import { buttonVariants } from './ui/button.js'
import { BACKDROP_CLASS, DIALOG_PRESSES_CLASS } from './ui/dialog.js'
import { ScrollArea } from './ui/scroll-area.js'
import { InSection } from './ui/section.js'
import { Select, SelectContent, SelectItem, SelectTriggerBare, SelectValue } from './ui/select.js'
import { MENU_TRIGGER_OPEN_CLASS } from './ui/dropdown-menu.js'
import { navRowClass } from './ui/nav-row.js'
import { cn } from '../lib/utils.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { SettingsFootContext } from './SettingsRows.js'

// Settings (#958): a dialog over the page you are on, a list of entries on the left and the
// picked entry's settings on the right. It opens from the person's menu and closes back to the
// page under it; the address carries it (`?settings=<entry>`), so a reload or a link opens it again.
//
// The list has two groups, by whose the settings are. First, with no title: the dashboard's own
// (how it looks, what it tells you) and the entries of the packages that are
// the computer's (Profile, Notifications), in one order by number: the dashboard's own stand at 20 to
// 80, so a package's entry goes before them, between two, or after them; the plugins kept per person
// or per computer, switched on and off, among them. Then "Project": the entries of the packages a
// project has (its Skills first), each saved in that project's own folder, its plugins, switched on
// and off, and the project's agent data, in one order the same way. That group shows the project picked in the
// sidebar, and its own select changes it without leaving Settings; with "All projects" an entry is
// every project's that has its package, and a change saves to each. The agent data is one project's
// at a time: with "All projects" that page asks for one.
//
// On a phone the dialog is the whole screen: the list first, then an entry over it, with a way back.

/** One entry of the list: the dashboard's own, or one a package adds. */
interface Entry {
  id: string
  /** Its place among the person's and this computer's entries, lower first: a package's entry says its own, 50 when unsaid. */
  order?: number
  title: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** The entry's settings. */
  body: ReactNode
}

/** The project select's value for every project. */
const ALL_PROJECTS = ''

export function SettingsDialog({
  entry,
  openItem,
  onEntry,
  onClose,
  scope,
  projects,
}: {
  /** The entry shown, by id; `''` shows the first one, and on a phone the list. */
  entry: string
  /** A page inside that entry to open, by what the entry knows it as; for a project's entry, the project, which the "Project" group then opens on. */
  openItem?: string | undefined
  /** Show another entry, or with `''` the list on a phone. */
  onEntry: (id: string) => void
  onClose: () => void
  /** The project picked in the sidebar: the one the "Project" group opens on, or null for all. */
  scope: string | null
  projects: ProjectSummary[]
}) {
  const mounted = useMountedModules().views['settings.section']
  // Chosen here rather than by `max-md:` classes: a package's stylesheet, loaded after the
  // dashboard's, sets `.flex` again and would beat a class that hides a flex box on a phone.
  const phone = useIsMobile()
  const listOnly = phone && entry === ''
  // Opened, the dialog itself has the focus, not its first entry: a ring there read as a second pick.
  const popup = useRef<HTMLDivElement>(null)
  // Opened by its address, nothing on the page opened it: closed, the focus goes to the page's title, not the page's body.
  const opener = useRef(document.activeElement)
  const finalFocus = (): HTMLElement | true => {
    const title = document.querySelector<HTMLElement>('h1')
    if (opener.current !== document.body || !title) return true
    title.tabIndex = -1
    return title
  }
  // A project's entry opened for one project (its Skills from the box's menu) is that project's, whatever the sidebar has picked.
  const [picked, setPicked] = useState((openItem !== undefined && projects.some(p => p.id === openItem) ? openItem : undefined) ?? scope ?? ALL_PROJECTS)
  // A project removed while the dialog is open is no longer one to show.
  const project = projects.find(p => p.id === picked) ?? null
  const label = useProjectLabel()
  const own = useOwnEntries()

  // Where an entry's presses go (`SettingsFoot`): under what scrolls, so they hold their place.
  const [foot, setFoot] = useState<HTMLDivElement | null>(null)
  const moduleEntry = (section: MountedView<'settings.section'>, of: ProjectSummary[]): Entry => {
    const Body = section.View
    return {
      id: section.id,
      ...(section.order !== undefined ? { order: section.order } : {}),
      title: section.title,
      icon: section.icon,
      body:
        section.pickProject !== undefined && !project ? (
          <PickProject words={section.pickProject} projects={of.filter(p => section.projects.includes(p.id))} onPick={setPicked} />
        ) : (
          <ModuleSlot package={section.package} label={`${section.title} settings`}>
            <Body projects={projectsHaving(section.projects, of)} {...(openItem !== undefined && section.id === entry ? { item: openItem } : {})} />
          </ModuleSlot>
        ),
    }
  }
  // Sorted once more with the dashboard's own: a package's entries are in their order already, and at the same number the dashboard's stands first.
  const byOrder = (a: Entry, b: Entry): number => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER)
  const yours = [...own, ...mounted.filter(section => section.computer).map(section => moduleEntry(section, []))].sort(byOrder)
  const forProject = mounted.filter(section => !section.computer && (project ? section.projects.includes(project.id) : section.projects.length > 0))
  // A page of the dashboard's own for one project at a time: with every project picked, it asks for one.
  const oneProject = (id: string, order: number, title: string, icon: Entry['icon'], Page: ComponentType<{ projectId: string }>, words: string): Entry => ({
    id,
    order,
    title,
    icon,
    body: project ? <Page projectId={project.id} /> : <PickProject words={words} projects={projects} onPick={setPicked} />,
  })
  const ownForProject: Entry[] =
    projects.length > 0
      ? [
          oneProject(PLUGINS_ENTRY, 15, 'Plugins', Blocks, ProjectPluginsSettings, 'Each project switches its plugins on and off. Pick a project.'),
        ]
      : []
  const projectEntries = [...ownForProject, ...forProject.map(section => moduleEntry(section, project ? [project] : projects))].sort(byOrder)
  const shown = [...yours, ...projectEntries].find(e => e.id === entry)
  const current = shown ?? yours[0]!
  // Opened with no entry, a computer shows the first: the address names it, as it names every other.
  useEffect(() => {
    if (!phone && entry === '') onEntry(current.id)
  }, [phone, entry, current.id, onEntry])
  const inProject = projectEntries.includes(current)
  // With every project picked, an entry that changes something says which projects a change goes to.
  const shownSection = inProject && !project ? forProject.find(s => s.id === current.id) : undefined
  const savedTo = shownSection && shownSection.readOnly !== true && shownSection.pickProject === undefined ? projectsHaving(shownSection.projects, projects) : []

  const item = (e: Entry) => {
    const Icon = e.icon
    return (
      <li key={e.id}>
        <button
          type="button"
          aria-current={e === current ? 'page' : undefined}
          onClick={() => {
            // The entry shown, pressed again, goes nowhere.
            if (e !== current || listOnly) onEntry(e.id)
          }}
          // The sidebar's row. On a phone the list is a page of its own: none is marked, since no entry is open beside it.
          className={cn(navRowClass(e === current && !phone), 'text-left')}
        >
          <Icon aria-hidden />
          <span className="truncate">{e.title}</span>
        </button>
      </li>
    )
  }
  // A bar's icon press, pulled out by its own padding so its glyph stands on the dialog's inset; a finger's 44 on a phone.
  const iconPress = cn(buttonVariants({ variant: 'ghost', size: 'icon-bar' }), 'text-muted-foreground hover:text-foreground')

  return (
    <BaseDialog.Root open onOpenChange={open => !open && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={BACKDROP_CLASS} />
        <BaseDialog.Popup
          data-overlay="dialog"
          ref={popup}
          initialFocus={popup}
          finalFocus={finalFocus}
          className={cn(
            'fixed z-50 flex overflow-hidden bg-card text-card-foreground outline-none',
            // It arrives as every dialog does: grown in over 180ms, gone in 120ms; on a phone, up from below.
            'transition-[opacity,scale,translate] duration-180 data-[ending-style]:duration-120 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            phone
              ? 'inset-0 data-[starting-style]:translate-y-8 data-[ending-style]:translate-y-8'
              : 'top-1/2 left-1/2 h-[min(42.5rem,calc(100dvh-3rem))] w-[min(60rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-hairline shadow-lg data-[starting-style]:scale-97 data-[ending-style]:scale-97',
          )}
        >
          {/* On a phone the list is the whole dialog until an entry is picked, and an entry the whole dialog after. */}
          {(!phone || listOnly) && (
            <nav aria-label="Settings" className={cn('flex shrink-0 flex-col gap-4 overflow-y-auto bg-sidebar px-2 pb-2', phone ? 'w-full' : 'w-56 border-r border-hairline pt-2')}>
              {/* The phone's top bar: its words and its close glyph on the screen's 16 inset. */}
              {phone && (
                <div className="flex h-12 shrink-0 items-center justify-between pl-2">
                  <BaseDialog.Title className="text-base font-semibold">Settings</BaseDialog.Title>
                  <BaseDialog.Close aria-label="Close settings" className={cn(iconPress, 'mr-0.5')}>
                    <X className="size-4" aria-hidden />
                  </BaseDialog.Close>
                </div>
              )}
              {/* Named for a screen reader only: the list starts with them, and needs no title over it. */}
              <section aria-label="You and this computer">
                <ul className="flex flex-col gap-0.5">{yours.map(item)}</ul>
              </section>
              <section aria-label="Project">
                <p className="flex h-8 items-center px-2 text-xs font-medium text-faint-foreground">Project</p>
                <ProjectSelect projects={projects} value={project?.id ?? ALL_PROJECTS} onChange={setPicked} />
                {projectEntries.length > 0 ? (
                  <ul className="mt-0.5 flex flex-col gap-0.5">{projectEntries.map(item)}</ul>
                ) : (
                  <p className="px-2 pt-2 text-xs text-muted-foreground">Nothing to set for your projects.</p>
                )}
              </section>
            </nav>
          )}
          {!listOnly && (
            // With no presses at its foot, the entry ends on the dialog's inset, as it begins under the head: what is cut at
            // the scroll edge fades out there, never on the window's own edge.
            <div className={cn('group/frame flex min-w-0 flex-1 flex-col', phone ? 'has-[>[data-foot]:empty]:pb-[max(1rem,env(safe-area-inset-bottom))]' : 'has-[>[data-foot]:empty]:pb-6')}>
              {/* The dialog's head on its one inset, as every dialog's (ui/dialog.tsx): 24 on a computer, a phone's top bar on a phone. */}
              <div className={cn('flex shrink-0 items-center gap-2', phone ? 'h-12 px-4' : 'h-6 box-content px-6 pt-4.5 pb-4')}>
                {phone && (
                  <button type="button" aria-label="All settings" onClick={() => onEntry('')} className={cn(iconPress, '-ml-1.5')}>
                    <ArrowLeft className="size-4" aria-hidden />
                  </button>
                )}
                {/* The entry's title leads; the project it is of quieter before it. */}
                <BaseDialog.Title className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold">
                  <span className="sr-only">Settings</span>
                  {inProject && (
                    <>
                      <span className="truncate font-medium text-faint-foreground">{project ? label(project.id, project.name) : 'All projects'}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-faint-foreground" aria-hidden />
                    </>
                  )}
                  <span className="truncate">{current.title}</span>
                </BaseDialog.Title>
                <BaseDialog.Close aria-label="Close settings" className={cn(iconPress, '-my-1 -mr-1.5')}>
                  <X className="size-4" aria-hidden />
                </BaseDialog.Close>
              </div>
              {/* `peer/entry`: what goes on under the foot fades out at the body's visible end, as under the chat's bar; on a
                  phone over 32, as the Subagents list's foot, so the fade reaches past the gap between two rows. */}
              <ScrollArea className={cn('peer/entry min-h-0 flex-1 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-4 after:bg-gradient-to-t after:from-card after:opacity-0 data-[overflow-y-end]:after:opacity-100', phone && 'after:h-8')}>
                <div className={cn('space-y-4', phone ? 'px-4 pt-2 pb-4' : 'px-6 pb-6', 'group-has-[>[data-foot]:empty]/frame:pb-0')}>
                  {savedTo.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Saved to {savedTo.length === 1 ? 'one project' : `${savedTo.length} projects`}: {savedTo.map(p => label(p.id, p.name)).join(', ')}.
                    </p>
                  )}
                  {/* Keyed by the projects too: an entry's reads and picks are of the projects it was drawn for. */}
                  <div key={`${current.id}/${project?.id ?? ALL_PROJECTS}`}>
                    <SettingsFootContext.Provider value={foot}>
                      {/* Under the entry's title, a section is a group of it. */}
                      <InSection>{current.body}</InSection>
                    </SettingsFootContext.Provider>
                  </div>
                </div>
              </ScrollArea>
              {/* The entry's presses on the dialog's inset, under a hairline, as every dialog's foot. */}
              <div ref={setFoot} data-foot className={cn('shrink-0 border-t border-hairline empty:hidden', phone ? 'px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]' : 'px-6 pt-4 pb-6', DIALOG_PRESSES_CLASS)} />
            </div>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/** The "Project" group's select, a row of the list that opens: every project, or one. */
function ProjectSelect({ projects, value, onChange }: { projects: ProjectSummary[]; value: string; onChange: (id: string) => void }) {
  const label = useProjectLabel()
  const items = [{ value: ALL_PROJECTS, label: 'All projects' }, ...projects.map(p => ({ value: p.id, label: label(p.id, p.name) }))]
  const picked = projects.find(p => p.id === value)
  return (
    <Select items={items} value={value} onValueChange={next => onChange(String(next ?? ALL_PROJECTS))}>
      <SelectTriggerBare aria-label="Project" className={cn(navRowClass(false), 'font-medium', MENU_TRIGGER_OPEN_CLASS)}>
        <span className="flex size-4 shrink-0 items-center justify-center">
          {picked ? <ProjectDot project={picked} /> : <Layers className="size-4 text-muted-foreground" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue />
        </span>
        <ChevronsUpDown aria-hidden />
      </SelectTriggerBare>
      <SelectContent>
        {items.map(i => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The dashboard's own entries: how it looks, the team that shares this machine, the plugins, the keys. */
function useOwnEntries(): Entry[] {
  return [
    {
      id: 'appearance',
      order: 20,
      title: 'Appearance',
      icon: Palette,
      body: <AppearanceSettings />,
    },
    {
      id: TEAM_ENTRY,
      order: 42,
      title: 'Team',
      icon: Users,
      body: <TeamSettings />,
    },
    {
      id: COMPUTER_PLUGINS_ENTRY,
      order: 45,
      title: 'Plugins',
      icon: Blocks,
      body: <ComputerPluginsSettings />,
    },
    {
      id: SHORTCUTS_ENTRY,
      order: 80,
      title: 'Keyboard shortcuts',
      icon: Keyboard,
      body: <ShortcutList />,
    },
  ]
}

