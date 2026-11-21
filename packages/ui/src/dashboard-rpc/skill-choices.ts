import type { ProjectRef } from '@openagt/hooks'
import { projectSkillNames } from '@openagt/skills'
import { distributionHooks, projectRefAt } from '../distribution-hooks.js'
import { SESSIONS_ID } from '../project-address.js'
import { resolveProjectPath } from './context.js'

// What a session picks under the message box, in the Skills menu: which of the plugins on in its
// project it goes without, so it gets none of their skills nor their steps; then the project's own
// skills, all, none or each. A run asks its modules for the same skills (`run.skills`), the plugins
// it goes without left out.

/** A plugin a session can go without. */
export interface PluginChoice {
  /** The plugin, by its module's name: what a session goes without. */
  name: string
  /** The skills it gives the project's runs, by name; none for one that gives them steps alone. */
  skills: string[]
}

export interface SkillChoices {
  /** The skills the project's runs get from its core modules, which no session goes without: github's, on GitHub. */
  core: string[]
  /** The plugins on in the project that give its runs a skill or a step, in the distribution's order. */
  plugins: PluginChoice[]
}

/**
 * What a session in the project `projectId` picks from ({@link SESSIONS_ID}: a session with no
 * project, which gets the plugins kept per project as the distribution starts them). `null` when
 * the project is unknown here.
 */
export async function onSkillChoices(projectId: string): Promise<SkillChoices | null> {
  let project: ProjectRef | undefined
  if (projectId !== SESSIONS_ID) {
    const cwd = await resolveProjectPath(projectId)
    if (!cwd) return null
    project = await projectRefAt(projectId, cwd)
  }
  const hooks = await distributionHooks()
  const where = project ? { project } : {}
  const [given, steps] = await Promise.all([hooks.skills(where), hooks.steps({ ...where, options: {} })])
  const plugins = hooks.modules.flatMap(module => {
    if (!module.plugin) return []
    const skills = given.filter(skill => skill.module === module.name).map(skill => skill.name)
    return skills.length > 0 || steps.some(step => step.module === module.name) ? [{ name: module.name, skills }] : []
  })
  return { core: given.filter(skill => !hooks.module(skill.module)?.plugin).map(skill => skill.name), plugins }
}

/**
 * The project's own skills, by name, as a run's checkout has them (`@openagt/skills`', which leaves
 * out the ones a session does not pick): what the Skills menu lists and counts. `null` when the
 * project is unknown here.
 */
export async function onProjectSkillNames(projectId: string): Promise<string[] | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  return projectSkillNames(cwd)
}
