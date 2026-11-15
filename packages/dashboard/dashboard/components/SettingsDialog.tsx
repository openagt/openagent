import { useCallback, useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { ArrowLeft, Bell, Bot, ChevronRight, ChevronsUpDown, Database, FolderGit2, Globe, Keyboard, Layers, Palette, Puzzle, UserRound, X, FolderSearch } from 'lucide-react'
import { ACCENTS, DEFAULT_ACCENT_LABELS, accentOf, CODE_FONTS, DOCUMENT_FONTS, DRIVERS, DRIVER_LABELS, isDriverName, FONTS, PALETTES, PALETTE_LABELS, type Accent, type CodeFont, type DocumentFont, type Font, type Palette as ColourPalette } from '../../src/client.js'
import { driverOptions, useModels } from '../lib/models.js'
import type { DriverOption } from './DriverModelMenu.js'
import type { ProjectSummary } from '../../src/index.js'
import { useMountedModules, type MountedSettings } from '../lib/use-modules.js'
import { SettingsCrumbContext, type SettingsCrumb } from '../lib/settings-crumb.js'
import { SettingsHoldContext } from '../lib/settings-hold.js'
import { holdEntry } from '../lib/use-route.js'
import { useIsMobile } from '../lib/use-mobile.js'
import { useDetectedEditors } from '../lib/editors.js'
import { usePreferences, updatePreferences, themePreference, type ThemePreference } from '../lib/preferences.js'
import { setBrowserNotifications, useNotificationPermission } from '../lib/notification-permission.js'
import { HUMAN_QUEUE_ABOUT, NEW_ACTIVITY_ABOUT, browserHint, kindHint } from '../lib/notification-words.js'
import { BridgeSettings } from './BridgeSettings.js'
import { AGENT_DATA_ENTRY, AgentDataSettings } from './AgentDataSettings.js'
import { PROFILE_ENTRY, ProfileSettings } from './ProfileSettings.js'
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
import { Switch } from './ui/switch.js'
import { Separator } from './ui/separator.js'
import { RadioGroup, RadioGroupItem } from './ui/radio-group.js'
import { ScrollArea } from './ui/scroll-area.js'
import { InSection, Section } from './ui/section.js'
import { Select, SelectContent, SelectItem, SelectTriggerBare, SelectValue } from './ui/select.js'
import { MENU_TRIGGER_OPEN_CLASS } from './ui/dropdown-menu.js'
import { navRowClass, PROJECT_ROW_CLASS } from './ui/nav-row.js'
import { cn } from '../lib/utils.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { SettingsFootContext, SettingsRow as Row, SettingsSection, SettingsSelectRow as SelectRow, type SettingsOption as SelectOption } from './SettingsRows.js'

// Settings (#958): a dialog over the page you are on, a list of entries on the left and the
// picked entry's settings on the right. It opens from the person's menu and closes back to the
// page under it; the address carries it (`?settings=<entry>`), so a reload or a link opens it again.
//
// The list has two groups, by whose the settings are. First, with no title: the dashboard's own
// (how it looks, what it tells you, which agent runs) and the entries of the packages that are
// the computer's (Devices, Machines), kept in the person's home folder. Then "Project": the entries
// of the packages a project has, each saved in that project's own folder, and the project's Skills.
// That group shows the project picked in the sidebar, and its own select changes it without leaving
// Settings; with "All projects" an entry is every project's that has its package, and a change saves
// to each. Skills are one project's at a time: with "All projects" that page asks for one.
//
// On a phone the dialog is the whole screen: the list first, then an entry over it, with a way back.

/** One entry of the list: the dashboard's own, or one a package adds. */
interface Entry {
  id: string
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
  const { settings: mounted } = useMountedModules()
  // Chosen here rather than by `max-md:` classes: a package's stylesheet, loaded after the
  // dashboard's, sets `.flex` again and would beat a class that hides a flex box on a phone.
  const phone = useIsMobile()
  const listOnly = phone && entry === ''
  // Opened, the dialog itself has the focus, not its first entry: a ring there read as a second pick.
  const popup = useRef<HTMLDivElement>(null)
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
  const moduleEntry = (section: MountedSettings, of: ProjectSummary[]): Entry => {
    const Body = section.Section
    return {
      id: section.id,
      title: section.title,
      icon: section.icon,
      body: (
        <ModuleSlot package={section.package} label={`${section.title} settings`}>
          <Body projects={projectsHaving(section.projects, of)} {...(openItem !== undefined && section.id === entry ? { item: openItem } : {})} />
        </ModuleSlot>
      ),
    }
  }
  const yours = [...own, ...mounted.filter(section => section.computer).map(section => moduleEntry(section, []))]
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
  const iconPress = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-muted-foreground hover:text-foreground max-md:size-11')

  return (
    <BaseDialog.Root open onOpenChange={open => !open && leave(onClose)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={BACKDROP_CLASS} />
        <BaseDialog.Popup
          data-overlay="dialog"
          ref={popup}
          initialFocus={popup}
          className={cn(
            'fixed z-50 flex overflow-hidden bg-background text-foreground outline-none',
            // It arrives as every dialog does: grown in over 180ms, gone in 120ms; on a phone, up from below.
            'transition-[opacity,scale,translate] duration-180 data-[ending-style]:duration-120 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            phone
              ? 'inset-0 data-[starting-style]:translate-y-8 data-[ending-style]:translate-y-8'
              : 'top-1/2 left-1/2 h-[min(42.5rem,calc(100dvh-3rem))] w-[min(60rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-hairline shadow-lg data-[starting-style]:scale-97 data-[ending-style]:scale-97',
          )}
        >
          {/* On a phone the list is the whole dialog until an entry is picked, and an entry the whole dialog after. */}
          {(!phone || listOnly) && (
            <nav aria-label="Settings" className={cn('flex shrink-0 flex-col gap-4 overflow-y-auto bg-sidebar p-2', phone ? 'w-full' : 'w-56 border-r border-hairline')}>
              {phone && (
                <div className="flex h-11 items-center justify-between pl-1.5">
                  <BaseDialog.Title className="text-base font-semibold">Settings</BaseDialog.Title>
                  <BaseDialog.Close aria-label="Close settings" className={iconPress}>
                    <X className="size-4" aria-hidden />
                  </BaseDialog.Close>
                </div>
              )}
              {/* Named for a screen reader only: the list starts with them, and needs no title over it. */}
              <section aria-label="You and this computer">
                <ul className="flex flex-col gap-px">{yours.map(item)}</ul>
              </section>
              <section aria-label="Project">
                <p className="flex h-8 items-center px-1.5 text-xs font-medium text-muted-foreground">Project</p>
                <ProjectSelect projects={projects} value={project?.id ?? ALL_PROJECTS} onChange={id => leave(() => setPicked(id))} />
                {projectEntries.length > 0 ? (
                  <ul className="mt-px flex flex-col gap-px">{projectEntries.map(item)}</ul>
                ) : (
                  <p className="px-1.5 pt-2 text-xs text-muted-foreground">Nothing to set for your projects.</p>
                )}
              </section>
            </nav>
          )}
          {!listOnly && (
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-14 shrink-0 items-center gap-2 px-6 max-md:px-2">
                {crumb ? (
                  <button type="button" aria-label={`Back to ${current.title}`} onClick={crumb.back} className={iconPress}>
                    <ArrowLeft className="size-4" aria-hidden />
                  </button>
                ) : (
                  phone && (
                    <button type="button" aria-label="All settings" onClick={() => leave(() => onEntry(''))} className={iconPress}>
                      <ArrowLeft className="size-4" aria-hidden />
                    </button>
                  )
                )}
                {/* The entry's title leads; where it is (the project, the entry a page is in) quieter before it. */}
                <BaseDialog.Title className="flex min-w-0 flex-1 items-center gap-1.5 text-base font-semibold">
                  <span className="sr-only">Settings</span>
                  {inProject && (
                    <>
                      <span className="truncate font-normal text-muted-foreground">{project ? label(project.id, project.name) : 'All projects'}</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </>
                  )}
                  {crumb ? (
                    <>
                      {!phone && (
                        <>
                          <button type="button" onClick={crumb.back} className="focus-ring truncate rounded-sm font-normal text-muted-foreground hover:text-foreground">
                            {current.title}
                          </button>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        </>
                      )}
                      <span className="truncate">{crumb.title}</span>
                    </>
                  ) : (
                    <span className="truncate">{current.title}</span>
                  )}
                </BaseDialog.Title>
                <BaseDialog.Close aria-label="Close settings" className={iconPress}>
                  <X className="size-4" aria-hidden />
                </BaseDialog.Close>
              </div>
              {/* `peer/entry`: the foot under it shows its line only while the entry scrolls on under it. */}
              <ScrollArea className="peer/entry min-h-0 flex-1">
                <div className="space-y-4 px-6 pb-6 max-md:px-4">
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
              <div
                ref={setFoot}
                className={cn('shrink-0 border-t border-transparent px-6 py-3 empty:hidden max-md:px-4 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]', 'peer-data-[overflow-y-end]/entry:border-hairline', DIALOG_PRESSES_CLASS)}
              />
            </div>
          )}
          <ConfirmDialog
            open={leaving !== undefined}
            onOpenChange={open => !open && setLeaving(undefined)}
            title="Leave without saving?"
            body={`What you changed in ${current.title} is not saved.`}
            confirmLabel="Leave"
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

/** The "Project" group's select, drawn as the sidebar's: every project, or one. */
function ProjectSelect({ projects, value, onChange }: { projects: ProjectSummary[]; value: string; onChange: (id: string) => void }) {
  const label = useProjectLabel()
  const items = [{ value: ALL_PROJECTS, label: 'All projects' }, ...projects.map(p => ({ value: p.id, label: label(p.id, p.name) }))]
  const picked = projects.find(p => p.id === value)
  return (
    <Select items={items} value={value} onValueChange={next => onChange(String(next ?? ALL_PROJECTS))}>
      <SelectTriggerBare aria-label="Project" className={cn(PROJECT_ROW_CLASS, MENU_TRIGGER_OPEN_CLASS)}>
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

/** The dashboard's own entries, the first of the list: who you are, how it looks, what it tells you, which agent runs, on which accounts, Claude web, the keys. */
function useOwnEntries(): Entry[] {
  const preferences = usePreferences()
  const editors = useDetectedEditors()
  const theme = themePreference(preferences)
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

  const palette = preferences.palette ?? 'openagent'

  return [
    {
      id: PROFILE_ENTRY,
      title: 'Profile',
      icon: UserRound,
      body: <ProfileSettings />,
    },
    {
      id: 'appearance',
      title: 'Appearance',
      icon: Palette,
      body: (
        <SettingsSection>
          <SelectRow
            label="Theme"
            description="Follow the system, or pin light or dark."
            value={theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={value => updatePreferences({ theme: value as ThemePreference })}
          />
          <SelectRow
            label="Colours"
            description="OpenAgent’s own Everforest colours, or neutral greys."
            value={palette}
            options={PALETTES.map(p => ({ value: p, label: PALETTE_LABELS[p] }))}
            // A primary colour is one of the palette's own: the new palette starts on its default.
            onChange={value => updatePreferences({ palette: value as ColourPalette, accent: '' as Accent })}
          />
          <SelectRow
            label="Primary colour"
            description="Buttons, links and what is picked, in the colours’ own hues."
            value={accentOf(palette, preferences.accent) ?? ''}
            options={[{ value: '', label: DEFAULT_ACCENT_LABELS[palette] }, ...ACCENTS[palette].map(accent => ({ value: accent, label: accent.charAt(0).toUpperCase() + accent.slice(1) }))]}
            // None picked is stored as nothing: the daemon keeps only a colour of the palette's list.
            onChange={value => updatePreferences({ accent: value as Accent })}
          />
          <SelectRow
            label="Font"
            description="The font of the page and the chat."
            value={preferences.font ?? 'ibm-plex-sans'}
            options={Object.entries(FONTS).map(([value, label]) => ({ value, label }))}
            onChange={value => updatePreferences({ font: value as Font })}
          />
          <SelectRow
            label="Code font"
            description="Code blocks, the files an agent read, the Files pane."
            value={preferences.codeFont ?? 'jetbrains-mono'}
            options={Object.entries(CODE_FONTS).map(([value, label]) => ({ value, label }))}
            onChange={value => updatePreferences({ codeFont: value as CodeFont })}
          />
          <SelectRow
            label="File preview font"
            description="A Markdown file read in the Files pane."
            value={preferences.documentFont ?? 'source-serif-4'}
            options={Object.entries(DOCUMENT_FONTS).map(([value, label]) => ({ value, label }))}
            onChange={value => updatePreferences({ documentFont: value as DocumentFont })}
          />
          <SelectRow
            label="Editor"
            description="Which editor “Open in editor” launches."
            value={preferences.editor ?? ''}
            options={[
              { value: '', label: 'Auto-detect' },
              ...editors.map(e => ({ value: e.bin, label: e.label })),
            ]}
            onChange={value => updatePreferences({ editor: value })}
          />
          {/* The Overview's checklist hides with its own ✕, and comes back here. */}
          <ToggleRow
            label="Onboarding on the Overview"
            description="The checklist of what a new install needs, on the Overview, under what needs you."
            checked={!(preferences.onboardingDismissed ?? false)}
            onChange={next => updatePreferences({ onboardingDismissed: !next })}
          />
        </SettingsSection>
      ),
    },
    {
      id: 'notifications',
      title: 'Notifications',
      icon: Bell,
      body: (
        <div className="flex flex-col gap-6">
          <HeadedSection heading="Deliver to">
            <ToggleRow
              label="Browser"
              description={browserHint(permission)}
              checked={(preferences.notifyBrowser ?? true) && permission !== 'default' && !browserBlocked}
              disabled={browserBlocked}
              onChange={setBrowserNotifications}
            />
          </HeadedSection>
          <Separator className="bg-hairline" />
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
                    <span className="text-warning">{missingDriver} is not installed on this computer.</span>
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
            description="A small model is asked for the two to five words a run's row shows, in place of the first line of your prompt. One short turn with no tools, about a thirtieth of a cent a run. Off, a run is listed by what you asked for."
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
      title: 'Your agent data',
      icon: FolderGit2,
      body: <AgentDataSettings />,
    },
    {
      id: REPO_SOURCES_ENTRY,
      title: 'Repos',
      icon: FolderSearch,
      body: <RepoSourcesSettings />,
    },
    {
      id: 'claude-web',
      title: 'Claude web',
      icon: Globe,
      body: (
        <SettingsSection description="A Claude web agent hands off and ends, so the questions its session asks never reach this dashboard. The Claude web bridge carries them back and types your answers into the session.">
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
          'A browser the daemon runs',
          'Chrome for Testing, downloaded once, signed in once, kept minimized. Web runs work with your own Chrome closed.',
          <BridgeBrowserSettings />,
        )}
        {option(
          false,
          'Your own Chrome',
          'Install the extension, open its options and paste the token. Web runs need your Chrome open.',
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

/** A setting that is on or off and takes effect at once: a switch, not a box to tick in a form still to be sent. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  dimmed = disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
  /** A capability the daemon or browser withholds, e.g. notifications the browser has blocked. */
  disabled?: boolean
  /** Greyed while what it needs is off, and still to be switched. */
  dimmed?: boolean
}) {
  const id = useId()
  return (
    <Row
      label={label}
      description={description}
      dimmed={dimmed}
      labelFor={id}
      control={
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={next => onChange(next === true)}
          aria-label={label}
        />
      }
    />
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
