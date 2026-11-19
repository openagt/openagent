import { useContext } from 'react'
import { onComputerPlugins, onProjectPlugins, sendSwitchPlugin, type PluginRow } from '../rpc/plugins.js'
import { usePolled } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { SettingsRow, SettingsRowShapes, SettingsSection, ToggleRow } from './SettingsRows.js'
import { Button } from './ui/button.js'
import { Slot } from './ui/slot.js'

// Settings › Plugins (#2394): each plugin of the distribution with its Enabled switch. One kept per
// project is switched in the project's group, one project at a time; one kept per person or per
// computer in the first group. A plugin that is off gives nothing: no page, no data, no skill and no
// step of a run. Every plugin starts off but the ones the distribution starts on. A git store,
// which keeps its own row, says here how it stands, and is switched on its own entry, which asks
// where to sync with and as whom.

/** The Settings entries' ids: the project's Plugins, and the first group's. */
export const PLUGINS_ENTRY = 'plugins'
export const COMPUTER_PLUGINS_ENTRY = 'computer-plugins'

/** Read again this often while the page is open: another device may switch one. */
const EVERY_MS = 10_000

/** Settings › Project › Plugins: the plugins kept per project, each switched in this project. */
export function ProjectPluginsSettings({ projectId }: { projectId: string }) {
  const read = usePolled<PluginRow[] | null>(() => onProjectPlugins(projectId), null, EVERY_MS, [projectId])
  return (
    <Slot of={read} shape={<SettingsRowShapes />}>
      {rows =>
        rows ? (
          <PluginSwitches rows={rows} projectId={projectId} reload={read.reload} none="No plugin is kept per project." />
        ) : (
          <p className="text-sm text-muted-foreground">This project&rsquo;s plugins are switched on the computer the project is on.</p>
        )
      }
    </Slot>
  )
}

/** Settings › Plugins in the first group: the plugins kept per person or per computer. */
export function ComputerPluginsSettings() {
  const read = usePolled<PluginRow[] | null>(onComputerPlugins, null, EVERY_MS, [])
  return (
    <Slot of={read} shape={<SettingsRowShapes />}>
      {rows => <PluginSwitches rows={rows ?? []} reload={read.reload} none="No plugin is kept per person or per computer." />}
    </Slot>
  )
}

/** One switch per plugin, saved at once, then read again; for a plugin that keeps its own row, how it stands and a press to where it is switched. */
function PluginSwitches({ rows, projectId, reload, none }: { rows: PluginRow[]; projectId?: string; reload: () => Promise<void>; none: string }) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const { busy, error, run } = useAction()
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{none}</p>
  const pick = async (row: PluginRow, on: boolean): Promise<void> => {
    await run(() => sendSwitchPlugin(row.name, on, projectId), `Could not switch ${row.name} ${on ? 'on' : 'off'}.`)
    await reload()
  }
  return (
    <SettingsSection>
      {rows.map(row => {
        const entry = row.settings
        return entry !== undefined ? (
          <SettingsRow
            key={row.name}
            label={row.name}
            description={`${row.description} ${row.on ? 'On' : 'Off'}.`}
            control={
              <Button variant="secondary" onClick={() => services.openSettings(entry, projectId)}>
                {row.on ? 'Change' : 'Switch on'}…
              </Button>
            }
          />
        ) : (
          <ToggleRow key={row.name} label={row.name} description={row.description} checked={row.on} disabled={busy} onChange={on => void pick(row, on)} />
        )
      })}
      {error && <p className="text-xs text-danger">{error}</p>}
    </SettingsSection>
  )
}
