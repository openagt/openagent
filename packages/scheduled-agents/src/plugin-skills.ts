import { fileURLToPath } from 'node:url'
import { nodeGitRunner } from '@openagt/git-branches'
import { type GitRunner, createHooks, loadHandedDown } from '@openagt/hooks'
import { projectOf } from '@openagt/agent-driver'
import type { Unlisted } from './schedule.js'

/** A skill a plugin on in the project gives its runs: its name, its folder, and the plugin. */
export interface PluginSkill {
  name: string
  /** Its folder, `SKILL.md` and the files beside it. */
  dir: string
  plugin: string
}

/** The plugins' skills, and what could not be read of them. */
export interface PluginSkills {
  skills: PluginSkill[]
  unreadable: Unlisted[]
}

/**
 * The skills the plugins on in the project give its runs (`run.skills`, #2394), read as a run's own
 * process reads them: off the distribution handed down to this process. A scheduler OpenAgent
 * started has it; one started by hand, outside OpenAgent, has none, and schedules only the
 * project's own skills. A plugin whose skills could not be read is named with why.
 */
export async function pluginSkills(repo: string, git: GitRunner = nodeGitRunner(), env: NodeJS.ProcessEnv = process.env): Promise<PluginSkills> {
  const unreadable: Unlisted[] = []
  const said = (err: unknown): string => (err instanceof Error ? err.message : String(err))
  try {
    const modules = await loadHandedDown(env)
    if (!modules) return { skills: [], unreadable }
    const hooks = createHooks(modules, { onError: ({ module, error }) => void unreadable.push({ skill: `the ${module} plugin's skills`, reason: said(error) }) })
    const project = await projectOf(repo, git)
    const skills = await hooks.skills({ ...(project ? { project } : {}), options: {} })
    return { skills: skills.map(skill => ({ name: skill.name, dir: skill.dir instanceof URL ? fileURLToPath(skill.dir) : skill.dir, plugin: skill.module })), unreadable }
  } catch (err) {
    return { skills: [], unreadable: [...unreadable, { skill: "the plugins' skills", reason: said(err) }] }
  }
}
