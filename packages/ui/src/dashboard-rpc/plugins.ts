import { errorMessage } from '../error-message.js'
import type { ProjectRef, SettingScope } from '@openagt/hooks'
import { distributionPlugins } from '../distribution-packages.js'
import { distributionHooks, projectRefAt } from '../distribution-hooks.js'
import { resolveProjectPath } from './context.js'

// Settings › Plugins (#2394): every plugin of the distribution with its Enabled row, the person's
// switch. One kept per project is switched in the project's group, one project at a time; one
// kept per person or per computer in the first group. The loader calls a plugin's hooks only where
// it is on: its pages, its data, its skills and its steps come and go with the switch. A plugin
// that keeps its own row, a git store's, is switched on its own Settings entry, which asks what
// switching takes: here it says how it stands, and leads there.

/** A plugin, as Settings › Plugins lists it. */
export interface PluginRow {
  /** Its module's name: what its Enabled row and a run's picks name it by. */
  name: string
  /** What its package says it is. */
  description: string
  /** Where its Enabled row is kept. */
  scope: SettingScope
  on: boolean
  /** For a plugin that keeps its own row: the Settings entry it is switched on, the project's for one kept per project. */
  settings?: string
}

/** The distribution's plugins kept where `kept` says, each with its row, in `project` for one kept per project, in the distribution's order. */
async function pluginRows(kept: (scope: SettingScope) => boolean, project?: ProjectRef): Promise<PluginRow[]> {
  const on = new Set(await (await distributionHooks()).on(project))
  return (await distributionPlugins())
    .filter(({ module }) => kept(module.plugin.scope))
    .map(({ module, description }) => ({
      name: module.name,
      description,
      scope: module.plugin.scope,
      on: on.has(module),
      ...(module.plugin.row ? { settings: module.plugin.row.settings } : {}),
    }))
}

/** The plugins kept per person or per computer: the first group's Plugins. */
export async function onComputerPlugins(): Promise<PluginRow[]> {
  return pluginRows(scope => scope !== 'project')
}

/** The plugins kept per project, each as it is in the project `projectId`; `null` for a project that is not on this computer. */
export async function onProjectPlugins(projectId: string): Promise<PluginRow[] | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  return pluginRows(scope => scope === 'project', await projectRefAt(projectId, cwd))
}

/** Switch the plugin `name` on or off: in the project `projectId` for one kept per project, which needs one. */
export async function sendSwitchPlugin(name: string, on: boolean, projectId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof name !== 'string' || typeof on !== 'boolean') return { ok: false, error: 'A plugin is switched on or off by its name.' }
  const hooks = await distributionHooks()
  const scope = hooks.module(name)?.plugin?.scope
  if (scope === 'project' && projectId === undefined) return { ok: false, error: `${name} is switched in a project.` }
  let project: ProjectRef | undefined
  if (scope === 'project') {
    const cwd = await resolveProjectPath(projectId!)
    if (!cwd) return { ok: false, error: 'That project is not on this computer.' }
    project = await projectRefAt(projectId!, cwd)
  }
  try {
    await hooks.setEnabled(name, on, project)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}
