import { useCallback, useContext, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { ArrowLeft, Bell, Bot, ChevronRight, ChevronsUpDown, Database, FolderGit2, Globe, Keyboard, Layers, Palette, Puzzle, X, FolderSearch } from 'lucide-react'
import { DRIVERS, DRIVER_LABELS, isDriverName } from '../../src/client.js'
import { driverOptions, useModels } from '../lib/models.js'
import type { DriverOption } from './DriverModelMenu.js'
import type { ProjectSummary } from '../../src/index.js'
import { DEFAULT_ORDER, useMountedModules, type MountedView } from '../lib/use-modules.js'
import { SettingsCrumbContext, type SettingsCrumb } from '../lib/settings-crumb.js'
import { SettingsHoldContext } from '../lib/settings-hold.js'
import { PERMISSIONS_PAGE, holdEntry } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { inPlace } from '../lib/in-place.js'
import { useIsMobile } from '../lib/use-mobile.js'
import { usePreferences, updatePreferences } from '../lib/preferences.js'
import { setBrowserNotifications, useNotificationPermission } from '../lib/notification-permission.js'
import { HUMAN_QUEUE_ABOUT, NEW_ACTIVITY_ABOUT, browserHint, kindHint } from '../lib/notification-words.js'
import { AppearanceSettings } from './AppearanceSettings.js'
import { BridgeSettings } from './BridgeSettings.js'
import { AGENT_DATA_ENTRY, AgentDataSettings } from './AgentDataSettings.js'
import { SHORTCUTS_ENTRY, ShortcutList } from './ShortcutList.js'
import { REPO_SOURCES_ENTRY, RepoSourcesSettings } from './RepoSourcesSettings.js'
import { SKILLS_ENTRY, SkillsSettings } from './ProjectSkills.js'
import { PickProject } from './PickProject.js'
import { ProjectDot } from './ProjectPicker.js'
import { PROJECT_AGENT_DATA_ENTRY, ProjectAgentDataSettings } from './ProjectAgentDataSettings.js'
import { BridgeBrowserSettings } from './BridgeBrowserSettings.js'
import { ModuleSlot, projectsHaving } from './ModulePageView.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { buttonVariants } from './ui/button.js'
import { BACKDROP_CLASS, DIALOG_PRESSES_CLASS } from './ui/dialog.js'
import { RadioGroup, RadioGroupItem } from './ui/radio-group.js'
import { ScrollArea } from './ui/scroll-area.js'
import { InSection, Section } from './ui/section.js'
import { Select, SelectContent, SelectItem, SelectTriggerBare, SelectValue } from './ui/select.js'
import { MENU_TRIGGER_OPEN_CLASS } from './ui/dropdown-menu.js'
import { navRowClass } from './ui/nav-row.js'
import { cn } from '../lib/utils.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { SettingsFootContext, SettingsSection, SettingsSelectRow as SelectRow, ToggleRow, type SettingsOption as SelectOption } from './SettingsRows.js'

// Settings (#958): a dialog over the page you are on, a list of entries on the left and the
// picked entry's settings on the right. It opens from the person's menu and closes back to the
// page under it; the address carries it (`?settings=<entry>`), so a reload or a link opens it again.
//
// The list has two groups, by whose the settings are. First, with no title: the dashboard's own
// (how it looks, what it tells you, which agent runs) and the entries of the packages that are
// the computer's (Profile, Devices), in one order by number: the dashboard's own stand at 20 to
// 80, so a package's entry goes before them, between two, or after them. Then "Project": the entries
// of the packages a project has, each saved in that project's own folder, and the project's Skills.
// That group shows the project picked in the sidebar, and its own select changes it without leaving
// Settings; with "All projects" an entry is every project's that has its package, and a change saves
// to each. Skills are one project's at a time: with "All projects" that page asks for one.
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
  /** A page inside that entry to open, by what the entry knows it as; for Skills, the project. */
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
  // Skills opened from a project's page are that project's, whatever the sidebar has picked.
  const [picked, setPicked] = useState((entry === SKILLS_ENTRY || entry === PROJECT_AGENT_DATA_ENTRY ? openItem : undefined) ?? scope ?? ALL_PROJECTS)
  // A project removed while the dialog is open is no longer one to show.
  const project = projects.find(p => p.id === picked) ?? null
  const label = useProjectLabel()
  const own = useOwnEntries()
  // A page inside the entry shown, which the entry says it opened: its title in the header, and the back arrow to the entry.
  const [crumb, setCrumb] = useState<SettingsCrumb | undefined>()
  // Where an entry's presses go (`SettingsFoot`): under what scrolls, so they hold their place.
  const [foot, setFoot] = useState<HTMLDivElement | null>(null)
  // A change the entry holds and has not saved: leaving it, by Back too, asks first, and the step asked about waits here.
  const [leaving, setLeaving] = useState<(() => void) | undefined>()
  const held = useRef<(() => void) | null>(null)
  const setHeld = useCallback((now: boolean) => {
    held.current?.()
    held.current = now ? holdEntry(step => setLeaving(() => step)) : null
  }, [])
  const leave = (step: () => void): void => (held.current ? setLeaving(() => step) : step())
  const moduleEntry = (section: MountedView<'settings.section'>, of: ProjectSummary[]): Entry => {
    const Body = section.View
    return {
      id: section.id,
      ...(section.order !== undefined ? { order: section.order } : {}),
      title: section.title,
      icon: section.icon,
      body: (
        <ModuleSlot package={section.package} label={`${section.title} settings`}>
          <Body projects={projectsHaving(section.projects, of)} {...(openItem !== undefined && section.id === entry ? { item: openItem } : {})} />
        </ModuleSlot>
      ),
    }
  }
  // Sorted once more with the dashboard's own: a package's entries are in their order already, and at the same number the dashboard's stands first.
  const yours = [...own, ...mounted.filter(section => section.computer).map(section => moduleEntry(section, []))].sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER))
  const forProject = mounted.filter(section => !section.computer && (project ? section.projects.includes(project.id) : section.projects.length > 0))
  // A page of the dashboard's own for one project at a time: with every project picked, it asks for one.
  const oneProject = (id: string, title: string, icon: Entry['icon'], Page: ComponentType<{ projectId: string }>, words: string): Entry => ({
    id,
    title,
    icon,
    body: project ? <Page projectId={project.id} /> : <PickProject words={words} projects={projects} onPick={setPicked} />,
  })
  const ownForProject: Entry[] =
    projects.length > 0
      ? [
          oneProject(SKILLS_ENTRY, 'Skills', Puzzle, SkillsSettings, 'Skills are written into a project’s own repository, one project at a time. Pick a project.'),
          oneProject(PROJECT_AGENT_DATA_ENTRY, 'Project agent data', Database, ProjectAgentDataSettings, 'Each project keeps its agent data in one place, your folder or its own repository. Pick a project.'),
        ]
      : []
  const projectEntries = [...ownForProject, ...forProject.map(section => moduleEntry(section, project ? [project] : projects))]
  const shown = [...yours, ...projectEntries].find(e => e.id === entry)
  const current = shown ?? yours[0]!
  // Opened with no entry, a computer shows the first: the address names it, as it names every other.
  useEffect(() => {
    if (!phone && entry === '') onEntry(current.id)
  }, [phone, entry, current.id, onEntry])
  const inProject = projectEntries.includes(current)
  // With every project picked, an entry says which projects a change goes to.
  const savedTo = inProject && !project ? projectsHaving(forProject.find(s => s.id === current.id)?.projects ?? [], projects) : []

  const item = (e: Entry) => {
    const Icon = e.icon
    return (
      <li key={e.id}>
        <button
          type="button"
          aria-current={e === current ? 'page' : undefined}
          onClick={() => {
            // The entry shown, pressed again, goes nowhere: it asks nothing, and what it holds stays held.
            if (e !== current || listOnly) leave(() => onEntry(e.id))
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
    <BaseDialog.Root open onOpenChange={open => !open && leave(onClose)}>
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
                <ProjectSelect projects={projects} value={project?.id ?? ALL_PROJECTS} onChange={id => leave(() => setPicked(id))} />
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
                  <button type="button" aria-label={crumb ? `Back to ${current.title}` : 'All settings'} onClick={crumb ? crumb.back : () => leave(() => onEntry(''))} className={cn(iconPress, '-ml-1.5')}>
                    <ArrowLeft className="size-4" aria-hidden />
                  </button>
                )}
                {/* The entry's title leads; where it is (the project, the entry a page is in) quieter before it, the entry its way back. */}
                <BaseDialog.Title className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold">
                  <span className="sr-only">Settings</span>
                  {inProject && !(phone && crumb) && (
                    <>
                      <span className="truncate font-medium text-faint-foreground">{project ? label(project.id, project.name) : 'All projects'}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-faint-foreground" aria-hidden />
                    </>
                  )}
                  {crumb ? (
                    <>
                      {!phone && (
                        <>
                          <button type="button" onClick={crumb.back} className="focus-ring -mx-1 truncate rounded-sm px-1 font-medium text-faint-foreground transition-colors hover:text-foreground">
                            {current.title}
                          </button>
                          <ChevronRight className="size-3.5 shrink-0 text-faint-foreground" aria-hidden />
                        </>
                      )}
                      <span className="truncate">{crumb.title}</span>
                    </>
                  ) : (
                    <span className="truncate">{current.title}</span>
                  )}
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
                    <SettingsCrumbContext.Provider value={setCrumb}>
                      <SettingsHoldContext.Provider value={setHeld}>
                        <SettingsFootContext.Provider value={foot}>
                          {/* Under the entry's title, a section is a group of it. */}
                          <InSection>{current.body}</InSection>
                        </SettingsFootContext.Provider>
                      </SettingsHoldContext.Provider>
                    </SettingsCrumbContext.Provider>
                  </div>
                </div>
              </ScrollArea>
              {/* The entry's presses on the dialog's inset, under a hairline, as every dialog's foot. */}
              <div ref={setFoot} data-foot className={cn('shrink-0 border-t border-hairline empty:hidden', phone ? 'px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]' : 'px-6 pt-4 pb-6', DIALOG_PRESSES_CLASS)} />
            </div>
          )}
          <ConfirmDialog
            open={leaving !== undefined}
            onOpenChange={open => !open && setLeaving(undefined)}
            title={`Discard your changes to ${current.title}?`}
            body={`What you changed in ${current.title} is not saved.`}
            confirmLabel="Discard"
            onSuccess={() => {
              setHeld(false)
              leaving?.()
            }}
          />
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

/** The dashboard's own entries: how it looks, what it tells you, which agent runs, your agent data, where repos come from, Claude web, the keys. */
function useOwnEntries(): Entry[] {
  const preferences = usePreferences()
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  // The start menu's own list (#1874), so Settings offers exactly the picks the menu does.
  const models = useModels()
  const drivers = driverOptions(models)
  const driver = preferences.driver ?? DRIVERS[0]
  const driverAnswer = isDriverName(driver) ? models?.[driver] : undefined
  const missingDriver = isDriverName(driver) && driverAnswer !== undefined && 'missing' in driverAnswer && driverAnswer.missing ? DRIVER_LABELS[driver] : undefined
  const model = preferences.model ?? ''
  // A notification toggle is a preference; whether it can deliver is the browser's permission
  // (#948). Both are shown, the same way the bell does, so the row cannot promise delivery that
  // will not happen.
  const permission = useNotificationPermission()
  const browserBlocked = permission === 'denied'
  // While the browser delivers nothing, the kinds wait on it: their rows are greyed, and still switch.
  const delivered = permission === 'unsupported' || ((preferences.notifyBrowser ?? true) && permission === 'granted')

  return [
    {
      id: 'appearance',
      order: 20,
      title: 'Appearance',
      icon: Palette,
      body: <AppearanceSettings />,
    },
    {
      id: 'notifications',
      order: 30,
      title: 'Notifications',
      icon: Bell,
      body: (
        <div className="flex flex-col gap-8">
          <HeadedSection heading="Deliver to">
            <ToggleRow
              label="Browser"
              description={browserHint(permission)}
              checked={(preferences.notifyBrowser ?? true) && permission !== 'default' && !browserBlocked}
              disabled={browserBlocked}
              onChange={setBrowserNotifications}
            />
          </HeadedSection>
          <HeadedSection heading="Notify me about">
            <ToggleRow
              label="Human Queue"
              description={kindHint(HUMAN_QUEUE_ABOUT, permission, preferences.notifyBrowser ?? true)}
              checked={preferences.notifyHumanIntervention ?? true}
              dimmed={!delivered}
              onChange={next => updatePreferences({ notifyHumanIntervention: next })}
            />
            <ToggleRow
              label="New activity"
              description={kindHint(NEW_ACTIVITY_ABOUT, permission, preferences.notifyBrowser ?? true)}
              dimmed={!delivered}
              checked={preferences.notifyNewActivity ?? false}
              onChange={next => updatePreferences({ notifyNewActivity: next })}
            />
          </HeadedSection>
        </div>
      ),
    },
    {
      id: 'agent',
      order: 40,
      title: 'Coding agent',
      icon: Bot,
      body: (
        <SettingsSection>
          <SelectRow
            label="Coding agent"
            description={
              <>
                Which coding agent runs the work.
                {missingDriver !== undefined && (
                  <>
                    {' '}
                    <span className="text-warning">{missingDriver} is not installed on this computer.</span>{' '}
                    <a href={services.pageHref(PERMISSIONS_PAGE)} onClick={inPlace(() => services.openPage(PERMISSIONS_PAGE))} className="text-primary hover:underline">
                      Install it on Permissions
                    </a>
                    .
                  </>
                )}
              </>
            }
            value={driver}
            options={drivers}
            // A model is always one agent's own (the start menu's rule), so a new agent starts unpinned.
            onChange={value => updatePreferences({ driver: value, model: '' })}
          />
          <SelectRow
            label="Model"
            description="The models the coding agent lists. Its own default when none is picked."
            value={model}
            options={modelOptions(drivers.find(d => d.value === driver), model)}
            onChange={value => updatePreferences({ model: value })}
          />
          <ToggleRow
            label="Name each run"
            description="A small model names each run in a few words, for about a thirtieth of a cent. Off, a run is listed by what you asked for."
            checked={preferences.nameRuns ?? true}
            onChange={next => updatePreferences({ nameRuns: next })}
          />
          <ToggleRow
            label="Show what the coding agent thought"
            description="Inside a run of steps, a row for each thought between them. Off, the panel is the steps the coding agent took and nothing else."
            checked={preferences.showThinking ?? false}
            onChange={next => updatePreferences({ showThinking: next })}
          />
        </SettingsSection>
      ),
    },
    {
      id: AGENT_DATA_ENTRY,
      order: 50,
      title: 'Your agent data',
      icon: FolderGit2,
      body: <AgentDataSettings />,
    },
    {
      id: REPO_SOURCES_ENTRY,
      order: 60,
      title: 'Repos',
      icon: FolderSearch,
      body: <RepoSourcesSettings />,
    },
    {
      id: 'claude-web',
      order: 70,
      title: 'Claude web',
      icon: Globe,
      body: (
        // The switch's two sentences say what it does and what it needs; an introduction above them told the same.
        <SettingsSection>
          <ToggleRow
            label="Claude web bridge"
            description="Carry claude.ai questions into this dashboard and type your answers back. A browser signed in to claude.ai does the work, through the bridge extension."
            checked={preferences.bridge ?? false}
            onChange={next => updatePreferences({ bridge: next })}
          />
          {(preferences.bridge ?? false) && (
            // One feature, one real choice (#1332): which browser drives claude.ai. Two toggles
            // named "Browser bridge" and "Bridge browser" read as anagrams; a choice under the
            // switch reads as what it is. The preference stays the boolean `bridgeBrowser`.
            <BridgeBrowserChoice
              daemonBrowser={preferences.bridgeBrowser ?? false}
              onChange={next => updatePreferences({ bridgeBrowser: next })}
            />
          )}
        </SettingsSection>
      ),
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

/**
 * Which browser does the bridge's work (#1332): one the daemon runs, with which web runs work with
 * the user's own Chrome closed, or the user's own Chrome with the extension set up
 * by hand. Each option carries what it needs right under it: the daemon's browser its status and
 * window controls, the user's Chrome the token to paste. Both can technically serve at once
 * (answers are claimed on read), but a person decides one, so it is presented as one.
 */
function BridgeBrowserChoice({ daemonBrowser, onChange }: { daemonBrowser: boolean; onChange: (daemonBrowser: boolean) => void }) {
  const question = useId()
  const option = (value: boolean, label: string, description: string, body: ReactNode) => (
    <label className="flex cursor-pointer gap-3">
      <RadioGroupItem value={value ? 'daemon' : 'own'} aria-label={label} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
        {daemonBrowser === value && body}
      </span>
    </label>
  )
  return (
    // One group with one name: the radio group is named by the question above it.
    <div>
      <p id={question} className="mb-3 text-sm font-medium">
        Which browser does the work?
      </p>
      <RadioGroup aria-labelledby={question} value={daemonBrowser ? 'daemon' : 'own'} onValueChange={next => onChange(next === 'daemon')} className="gap-4">
        {option(
          true,
          'A browser the dashboard runs',
          'Chrome for Testing, downloaded once, signed in once, kept minimized. Web runs work with your own Chrome closed.',
          <BridgeBrowserSettings />,
        )}
        {option(
          false,
          'Your own Chrome',
          'Install the extension from the folder below, open its options and paste the token. Web runs need your Chrome open.',
          <BridgeSettings />,
        )}
      </RadioGroup>
    </div>
  )
}

/** A group of rows under a heading of its own. */
function HeadedSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Section title={heading}>
      <SettingsSection>{children}</SettingsSection>
    </Section>
  )
}

/**
 * The Model row's choices: the agent's own default first (the one pick the start menu has no entry
 * for, since a menu entry is always a real model), then the models the agent listed. A saved model
 * the list does not hold is kept, by its id, since that id is still what a start is given; a list
 * not answered yet, or that could not be had, says why in a line that cannot be picked.
 */
function modelOptions(driver: DriverOption | undefined, model: string): SelectOption[] {
  const listed = driver?.models ?? []
  return [
    { value: '', label: 'Default' },
    ...listed,
    ...(model && !listed.some(m => m.value === model) ? [{ value: model, label: model }] : []),
    ...(listed.length === 0 && driver?.modelsNote ? [{ value: driver.modelsNote, label: driver.modelsNote, disabled: true }] : []),
  ]
}
