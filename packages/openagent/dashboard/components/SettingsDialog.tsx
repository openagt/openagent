import { useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Dialog as BaseDialog } from '@base-ui-components/react/dialog'
import { ArrowLeft, Bell, Bot, ChevronRight, Globe, Palette, X } from 'lucide-react'
import { DRIVERS } from '../../src/client.js'
import { driverOptions, useModels } from '../lib/models.js'
import { NO_MODEL_PINNED } from '../lib/agent-settings.js'
import type { DriverOption } from './DriverModelMenu.js'
import type { ProjectSummary } from '../../src/index.js'
import { useMountedModules, type MountedSettings } from '../lib/use-modules.js'
import { useIsMobile } from '../lib/use-mobile.js'
import { useDetectedEditors } from '../lib/editors.js'
import { usePreferences, updatePreferences, themePreference, type ThemePreference } from '../lib/preferences.js'
import { useNotificationPermission } from '../lib/notification-permission.js'
import { BridgeSettings } from './BridgeSettings.js'
import { BridgeBrowserSettings } from './BridgeBrowserSettings.js'
import { ModuleSlot, projectsHaving } from './ModulePageView.js'
import { Switch } from './ui/switch.js'
import { RadioGroup, RadioGroupItem } from './ui/radio-group.js'
import { ScrollArea } from './ui/scroll-area.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'
import { cn } from '../lib/utils.js'
import { SettingsRow as Row, SettingsSection as Section, SettingsSelectRow as SelectRow, type SettingsOption as SelectOption } from './SettingsRows.js'

// Settings (#958): a dialog over the page you are on, a list of entries on the left and the
// picked entry's settings on the right. It opens from the person's menu and closes back to the
// page under it; the address carries it (`?settings=<entry>`), so a reload or a link opens it again.
//
// The list has two groups, by whose the settings are. First, with no title: the dashboard's own
// (how it looks, what it tells you, which agent runs) and the entries of the packages that are
// the computer's (Devices, Machines), kept in the person's home folder. Then "Project": the entries
// of the packages a project has, each saved in that project's own folder. That group shows the
// project picked in the sidebar, and its own select changes it without leaving Settings; with
// "All projects" an entry is every project's that has its package, and a change saves to each.
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
  onEntry,
  onClose,
  scope,
  projects,
}: {
  /** The entry shown, by id; `''` shows the first one, and on a phone the list. */
  entry: string
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
  const [picked, setPicked] = useState(scope ?? ALL_PROJECTS)
  // A project removed while the dialog is open is no longer one to show.
  const project = projects.find(p => p.id === picked) ?? null
  const own = useOwnEntries()
  const moduleEntry = (section: MountedSettings, of: ProjectSummary[]): Entry => {
    const Body = section.Section
    return {
      id: section.id,
      title: section.title,
      icon: section.icon,
      body: (
        <ModuleSlot package={section.package} label={`${section.title} settings`}>
          <Body projects={projectsHaving(section.projects, of)} />
        </ModuleSlot>
      ),
    }
  }
  const yours = [...own, ...mounted.filter(section => section.computer).map(section => moduleEntry(section, []))]
  const forProject = mounted.filter(section => !section.computer && (project ? section.projects.includes(project.id) : section.projects.length > 0))
  const projectEntries = forProject.map(section => moduleEntry(section, project ? [project] : projects))
  const shown = [...yours, ...projectEntries].find(e => e.id === entry)
  const current = shown ?? yours[0]!
  const inProject = projectEntries.includes(current)
  // With every project picked, an entry says which projects a change goes to.
  const savedTo = inProject && !project ? projectsHaving(forProject.find(s => s.id === current.id)!.projects, projects) : []

  const item = (e: Entry) => {
    const Icon = e.icon
    return (
      <li key={e.id}>
        <button
          type="button"
          aria-current={e === current ? 'page' : undefined}
          onClick={() => onEntry(e.id)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
            // A hovered row is a lighter shade than the picked one, so the two never read alike. On a
            // phone the list is a page of its own: taller rows, and none marked, since no entry is open beside it.
            phone ? 'h-10' : 'h-8 aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium',
          )}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{e.title}</span>
        </button>
      </li>
    )
  }

  return (
    <BaseDialog.Root open onOpenChange={open => !open && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <BaseDialog.Popup
          ref={popup}
          initialFocus={popup}
          className={cn(
            'fixed z-50 flex overflow-hidden bg-background text-foreground outline-none',
            phone ? 'inset-0' : 'top-1/2 left-1/2 h-[min(40rem,calc(100dvh-2rem))] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border shadow-lg',
          )}
        >
          {/* On a phone the list is the whole dialog until an entry is picked, and an entry the whole dialog after. */}
          {(!phone || listOnly) && (
            <nav aria-label="Settings" className={cn('flex shrink-0 flex-col gap-4 overflow-y-auto bg-sidebar p-2', phone ? 'w-full' : 'w-56 border-r border-border')}>
              {phone && (
                <div className="flex h-10 items-center justify-between px-2">
                  <BaseDialog.Title className="text-base font-semibold">Settings</BaseDialog.Title>
                  <BaseDialog.Close aria-label="Close settings" className="rounded p-1 text-muted-foreground outline-none hover:text-foreground">
                    <X className="size-4" aria-hidden />
                  </BaseDialog.Close>
                </div>
              )}
              {/* Named for a screen reader only: the list starts with them, and needs no title over it. */}
              <section aria-label="You and this computer">
                <ul className="flex flex-col gap-1">{yours.map(item)}</ul>
              </section>
              <section aria-label="Project">
                <div className="flex items-center gap-2 px-2 pb-1">
                  <p className="text-xs font-medium text-muted-foreground">Project</p>
                  <ProjectSelect projects={projects} value={project?.id ?? ALL_PROJECTS} onChange={setPicked} />
                </div>
                {projectEntries.length > 0 ? (
                  <ul className="flex flex-col gap-1">{projectEntries.map(item)}</ul>
                ) : (
                  <p className="px-2 text-xs text-muted-foreground">{project ? 'Nothing to set for this project.' : 'Nothing to set for your projects.'}</p>
                )}
              </section>
            </nav>
          )}
          {!listOnly && (
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-12 shrink-0 items-center gap-2 px-4">
                {phone && (
                  <button type="button" aria-label="All settings" onClick={() => onEntry('')} className="-ml-1 rounded p-1 text-muted-foreground outline-none hover:text-foreground">
                    <ArrowLeft className="size-4" aria-hidden />
                  </button>
                )}
                <BaseDialog.Title className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-normal">
                  {!phone && (
                    <>
                      <span className="text-muted-foreground">Settings</span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </>
                  )}
                  {inProject && (
                    <>
                      <span className="truncate text-muted-foreground">{project?.name ?? 'All projects'}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </>
                  )}
                  <span className="truncate font-medium">{current.title}</span>
                </BaseDialog.Title>
                <BaseDialog.Close aria-label="Close settings" className="rounded p-1 text-muted-foreground outline-none hover:text-foreground">
                  <X className="size-4" aria-hidden />
                </BaseDialog.Close>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto max-w-2xl space-y-3 px-4 pb-6">
                  {savedTo.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Saved to {savedTo.length === 1 ? 'one project' : `${savedTo.length} projects`}: {savedTo.map(p => p.name).join(', ')}.
                    </p>
                  )}
                  {/* Keyed by the projects too: an entry's reads and picks are of the projects it was drawn for. */}
                  <div key={`${current.id}/${project?.id ?? ALL_PROJECTS}`}>{current.body}</div>
                </div>
              </ScrollArea>
            </div>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/** The "Project" group's select: every project, or one. */
function ProjectSelect({ projects, value, onChange }: { projects: ProjectSummary[]; value: string; onChange: (id: string) => void }) {
  const items = [{ value: ALL_PROJECTS, label: 'All projects' }, ...projects.map(p => ({ value: p.id, label: p.name }))]
  return (
    <Select items={items} value={value} onValueChange={next => onChange(String(next ?? ALL_PROJECTS))}>
      <SelectTrigger size="sm" aria-label="Project" className="h-6 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-xs shadow-none">
        <SelectValue />
      </SelectTrigger>
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

/** The dashboard's own entries, the first of the list: how it looks, what it tells you, which agent runs, Claude web. */
function useOwnEntries(): Entry[] {
  const preferences = usePreferences()
  const editors = useDetectedEditors()
  const theme = themePreference(preferences)
  // The start menu's own list (#1874), so Settings offers exactly the picks the menu does.
  const drivers = driverOptions(useModels())
  const driver = preferences.driver ?? DRIVERS[0]
  const model = preferences.model ?? ''
  // A notification toggle is a preference; whether it can deliver is the browser's permission
  // (#948). Both are shown, the same way the bell does, so the row cannot promise delivery that
  // will not happen.
  const permission = useNotificationPermission()
  const browserBlocked = permission === 'denied'

  return [
    {
      id: 'appearance',
      title: 'Appearance',
      icon: Palette,
      body: (
        <Section>
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
            description="The checklist of what a new install needs, at the top of the Overview."
            checked={!(preferences.onboardingDismissed ?? false)}
            onChange={next => updatePreferences({ onboardingDismissed: !next })}
          />
        </Section>
      ),
    },
    {
      id: 'notifications',
      title: 'Notifications',
      icon: Bell,
      body: (
        <Section>
          <ToggleRow
            label="Browser"
            description={
              browserBlocked
                ? 'Blocked in your browser settings'
                : 'Desktop notifications while the dashboard is open.'
            }
            checked={(preferences.notifyBrowser ?? true) && !browserBlocked}
            disabled={browserBlocked}
            onChange={next => updatePreferences({ notifyBrowser: next })}
          />
          <ToggleRow
            label="Human Queue"
            description="An agent awaiting your answer, or a PR ready to review."
            checked={preferences.notifyHumanIntervention ?? true}
            onChange={next => updatePreferences({ notifyHumanIntervention: next })}
          />
          <ToggleRow
            label="New activity"
            description="Also ping when an agent starts or finishes."
            checked={preferences.notifyNewActivity ?? false}
            onChange={next => updatePreferences({ notifyNewActivity: next })}
          />
        </Section>
      ),
    },
    {
      id: 'agent',
      title: 'Agent',
      icon: Bot,
      body: (
        <Section>
          <SelectRow
            label="Agent"
            description="Which coding agent runs the work."
            value={driver}
            options={drivers}
            // A model is always one agent's own (the start menu's rule), so a new agent starts unpinned.
            onChange={value => updatePreferences({ driver: value, model: '' })}
          />
          <SelectRow
            label="Model"
            description="The models the agent lists. Its own default when none is picked."
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
            label="Show what the agent thought"
            description="Inside a run of steps, a row for each thought between them. Off, the panel is the steps the agent took and nothing else."
            checked={preferences.showThinking ?? false}
            onChange={next => updatePreferences({ showThinking: next })}
          />
          <ToggleRow
            label="Post-merge cleanup"
            description="The box in the launcher's Auto menu, ticked by default: once a run ends done with a pull request, a fresh agent runs /post-merge-cleanup on its branch before it merges. In projects with that command."
            checked={preferences.postMergeCleanup ?? false}
            onChange={next => updatePreferences({ postMergeCleanup: next })}
          />
        </Section>
      ),
    },
    {
      id: 'claude-web',
      title: 'Claude web',
      icon: Globe,
      body: (
        <Section description="A Claude web agent hands off and ends, so the questions its session asks never reach this dashboard. The browser bridge carries them back and types your answers into the session.">
          <ToggleRow
            label="Browser bridge"
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
        </Section>
      ),
    },
  ]
}

/**
 * Which browser does the bridge's work (#1332): one the daemon runs — recommended, since web runs
 * then work with the user's own Chrome closed — or the user's own Chrome with the extension set up
 * by hand. Each option carries what it needs right under it: the daemon's browser its status and
 * window controls, the user's Chrome the token to paste. Both can technically serve at once
 * (answers are claimed on read), but a person decides one, so it is presented as one.
 */
function BridgeBrowserChoice({ daemonBrowser, onChange }: { daemonBrowser: boolean; onChange: (daemonBrowser: boolean) => void }) {
  const question = useId()
  const option = (value: boolean, label: string, description: string, body: ReactNode) => (
    <label className={cn('flex cursor-pointer gap-3 rounded-md border p-3', daemonBrowser === value ? 'border-primary/60 bg-muted/20' : 'border-border')}>
      <RadioGroupItem value={value ? 'daemon' : 'own'} aria-label={label} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
        {daemonBrowser === value && body}
      </span>
    </label>
  )
  return (
    // One group with one name: the radio group is named by the question above it.
    <div className="mt-3">
      <p id={question} className="mb-2 text-sm font-medium">
        Which browser does the work?
      </p>
      <RadioGroup aria-labelledby={question} value={daemonBrowser ? 'daemon' : 'own'} onValueChange={next => onChange(next === 'daemon')}>
        {option(
          true,
          'A browser the daemon runs — recommended',
          'Chrome for Testing, downloaded once, signed in once, kept minimized. Web runs work with your own Chrome closed.',
          <BridgeBrowserSettings enabled />,
        )}
        {option(
          false,
          'Your own Chrome',
          'Install the extension, open its options and paste the token. Web runs need your Chrome open.',
          <BridgeSettings enabled onChange={() => {}} />,
        )}
      </RadioGroup>
    </div>
  )
}

/** A setting that is on or off and takes effect at once: a switch, not a box to tick in a form still to be sent. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
  /** A capability the daemon or browser withholds, e.g. notifications the browser has blocked. */
  disabled?: boolean
}) {
  return (
    <Row
      label={label}
      description={description}
      dimmed={disabled}
      control={
        <Switch
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
    { value: '', label: NO_MODEL_PINNED },
    ...listed,
    ...(model && !listed.some(m => m.value === model) ? [{ value: model, label: model }] : []),
    ...(listed.length === 0 && driver?.modelsNote ? [{ value: driver.modelsNote, label: driver.modelsNote, disabled: true }] : []),
  ]
}
