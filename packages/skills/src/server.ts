import { PICKED_PROFILE, PROFILES, profileOf, type PluginsOptions, type Profile, type SkillsOptions } from '@openagt/hooks'
import { read, type RpcHost } from '@openagt/hooks/rpc'
import type { UiCommand } from '@openagt/hooks/ui'
import { projectSkillNames } from './left-out.js'
import { skillsOn, startBranch } from './on-branch.js'
import { readProjectSkills, type ProjectSkill } from './project-skills.js'

// skills' server part (`@openagt/hooks/rpc`), in the project it is called in: what Settings ›
// Skills lists, what the gear's Skills line under the message box picks from, and the commands the
// box offers. It only reads: OpenAgent installs no skill in a project, and changes none.

/** One of the project's own skills, and whether its runs have it yet. */
export interface ListedSkill extends ProjectSkill {
  /** In the project's folder, not yet on the branch runs start from: a run started now does not get it. */
  waiting?: true
}

/** The project's own skills, as Settings › Skills lists them. */
export interface ProjectSkills {
  skills: ListedSkill[]
  /** The branch runs start from, by its name: origin's default branch, else the folder's own. Absent where there is none. */
  startBranch?: string
}

/** The project's own skills, each said waiting while it is not on the branch runs start from as this clone has it. */
export const projectSkills = read(async (host: RpcHost, _input: object): Promise<ProjectSkills> => {
  const [skills, start] = await Promise.all([readProjectSkills(host.root), startBranch(host.root)])
  if (!start) return { skills }
  const on = await skillsOn(host.root, start.ref)
  return { skills: skills.map(skill => (on.has(skill.name) ? skill : { ...skill, waiting: true as const })), startBranch: start.name }
})

/** A plugin a session can go without. */
export interface PluginChoice {
  /** The plugin, by its module's name: what a session goes without. */
  name: string
  /** The skills it gives the project's runs, by name; none for one that gives them steps alone. */
  skills: string[]
}

/** What the Skills line picks from, and what a run gets where it picks nothing. */
export interface SkillChoices {
  /** The skills the project's runs get from its core modules, which no session goes without: github's, on GitHub. */
  core: string[]
  /** The plugins on in the project that give its runs a skill or a step, in the distribution's order. */
  plugins: PluginChoice[]
  /** The project's own skills, by name, as a run's checkout has them; none with no project. */
  project: string[]
  /** What the profile in force has of the skills: the one named, else the one picked for every next run, else Default. */
  profile: { without?: string[]; project?: SkillsOptions['project'] }
}

/**
 * What a session in the project picks from in the Skills line: the plugins on there that give its
 * runs something, the core modules' skills, and the project's own skills; with no project (a
 * session with none), the plugins as the distribution starts them; with `every` (a profile's
 * editor, for any project), every plugin that gives runs something, off or on. And what the
 * profile in force has of them: `profile`, the one a session's record names, else the one picked
 * for every next run on this computer, else Default.
 */
export const skillChoices = read(async (host: RpcHost, input: { profile?: string; every?: boolean }): Promise<SkillChoices> => {
  const project = await host.project()
  const [modules, own, saved, picked] = await Promise.all([host.modulesOn({ every: input.every === true }), project ? projectSkillNames(host.root) : [], host.settings.get(PROFILES).catch((): Profile[] => []), host.settings.get(PICKED_PROFILE).catch(() => undefined)])
  const options = profileOf(saved, typeof input.profile === 'string' ? input.profile : picked).options
  const without: PluginsOptions['without'] = options.plugins?.without
  const projectPick = options.skills?.project
  return {
    core: modules.filter(module => !module.plugin).flatMap(module => module.skills),
    plugins: modules.filter(module => module.plugin && (module.skills.length > 0 || module.steps)).map(module => ({ name: module.name, skills: module.skills })),
    project: own,
    profile: { ...(without !== undefined ? { without } : {}), ...(projectPick !== undefined ? { project: projectPick } : {}) },
  }
})

/**
 * The commands the message box offers in the project: its own skills written to be run by a person
 * (a skill's `command`), typed after the slash, each said waiting while it is not on the branch
 * runs start from. OpenAgent ships no prompt text: what a project can be asked to do is what its own
 * command skills say. None with no project.
 */
export const commands = read(async (host: RpcHost, _input: object): Promise<UiCommand[]> => {
  if (!(await host.project())) return []
  const [skills, start] = await Promise.all([readProjectSkills(host.root), startBranch(host.root)])
  const listed = skills.filter(skill => skill.command).map(({ name, description }): UiCommand => ({ name, ...(description !== undefined ? { description } : {}) }))
  if (!start || listed.length === 0) return listed
  const on = await skillsOn(host.root, start.ref)
  return listed.map(command => (on.has(command.name) ? command : { ...command, waiting: start.name }))
})
