import type { ReactNode } from 'react'
import { DRIVERS } from '../../src/client.js'
import { driverOptions, useModels } from '../lib/models.js'
import { NO_MODEL_PINNED } from '../lib/agent-settings.js'
import type { DriverOption } from './DriverModelMenu.js'
import { onProjects } from '../rpc/projects.js'
import { ModuleSettingsSections } from './ModuleSettingsSections.js'
import { useLoaded } from '../lib/use-async.js'
import type { ProjectSummary } from '../../src/index.js'
import { useDetectedEditors } from '../lib/editors.js'
import { usePreferences, updatePreferences, themePreference, type ThemePreference } from '../lib/preferences.js'
import { useNotificationPermission } from '../lib/notification-permission.js'
import { OnboardingChecklist } from './OnboardingChecklist.js'
import { BridgeSettings } from './BridgeSettings.js'
import { BridgeBrowserSettings } from './BridgeBrowserSettings.js'
import { MachinesSettings } from './MachinesSettings.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Checkbox } from './ui/checkbox.js'
import { ScrollArea } from './ui/scroll-area.js'
import { cn } from '../lib/utils.js'
import { SettingsRow as Row, SettingsSection as Section, SettingsSelectRow as SelectRow, type SettingsOption as SelectOption } from './SettingsRows.js'

// The settings page (#958): every setting in one place, and the Onboarding checklist.
//
// Until now settings were spread across the header's menus — the composer's gear, the bell, the
// theme toggle — which is fine while you are running something and useless when you are looking
// for one. This is the page the Overview's "you can resume the onboarding on the settings page"
// points at, so the checklist lives here too and is not dismissible.
//
// Everything here writes your own settings, the same on every project: what is a project's own
// (how a run is started) lives in that project's hooks file, not here. After the page's own sections come the ones the installed packages
// bring, each the package's own, read and written through its own command.

export function SettingsPage({
  onAgentStarted,
  onSelectProject,
}: {
  /** Where a session the onboarding checklist starts lands (#1169): on that session. */
  onAgentStarted: (projectId: string, intent: string, agentId: string) => void
  /** Where the checklist's "Configure first, then run" lands (#1507): that project's launcher. */
  onSelectProject: (id: string) => void
  onDone?: () => void
}) {
  const preferences = usePreferences()
  const projects = useLoaded<ProjectSummary[]>(onProjects, [], [])
  const editors = useDetectedEditors()
  const theme = themePreference(preferences)
  // The start menu's own list (#1874), so Settings offers exactly the picks the menu does.
  const drivers = driverOptions(useModels())
  const driver = preferences.driver ?? DRIVERS[0]
  const model = preferences.model ?? ''
  // One shared table with the launcher (#958), rules already applied.
  // A notification toggle is a preference; whether it can deliver is the browser's permission
  // (#948). Both are shown, the same way the bell does, so the row cannot promise delivery that
  // will not happen.
  const permission = useNotificationPermission()
  const browserBlocked = permission === 'denied'

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Your defaults, everywhere.
          </p>
        </div>

        <OnboardingChecklist onAgentStarted={onAgentStarted} onSelectProject={onSelectProject} />

        <Section title="Appearance">
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
        </Section>

        <Section title="Agent">
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
            label="Post-merge cleanup"
            description="The box in the launcher's Auto menu, ticked by default: once a run ends done with a pull request, a fresh agent runs /post-merge-cleanup on its branch before it merges. In projects with that command."
            checked={preferences.postMergeCleanup ?? false}
            onChange={next => updatePreferences({ postMergeCleanup: next })}
          />
        </Section>

        {/* A saved machine is the other place a session can run on. */}
        <MachinesSettings />

        <Section title="Notifications">
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

        <Section
          title="Claude web"
          description="A Claude web agent hands off and ends, so the questions its session asks never reach this dashboard. The browser bridge carries them back and types your answers into the session."
        >
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

        {/* What the installed packages bring: each its own section, after the page's own. */}
        <ModuleSettingsSections projects={projects} />
      </div>
    </ScrollArea>
  )
}

/**
 * Which browser does the bridge's work (#1332): one the daemon runs — recommended, since web runs
 * then work with the user's own Chrome closed — or the user's own Chrome with the extension set up
 * by hand. Each option carries what it needs right under it: the daemon's browser its status and
 * window controls, the user's Chrome the token to paste. Both can technically serve at once
 * (answers are claimed on read), but a person decides one, so it is presented as one.
 */
function BridgeBrowserChoice({ daemonBrowser, onChange }: { daemonBrowser: boolean; onChange: (daemonBrowser: boolean) => void }) {
  const option = (value: boolean, label: string, description: string, body: ReactNode) => (
    <label className={cn('flex cursor-pointer gap-3 rounded-md border p-3', daemonBrowser === value ? 'border-primary/60 bg-muted/20' : 'border-border')}>
      <input
        type="radio"
        name="bridge-browser"
        className="mt-1 shrink-0"
        checked={daemonBrowser === value}
        onChange={() => onChange(value)}
        aria-label={label}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
        {daemonBrowser === value && body}
      </span>
    </label>
  )
  return (
    <fieldset className="mt-3 space-y-2">
      <legend className="text-sm font-medium">Which browser does the work?</legend>
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
    </fieldset>
  )
}

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
        <Checkbox
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
