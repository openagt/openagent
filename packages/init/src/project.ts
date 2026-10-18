import { lstat, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeGitRunner, OPENAGENT_DIR, type GitRunner } from '@openagt/agent-data'
import { hasHooks } from '@openagt/agent-scheduler'
import { homeUrlFromRemote } from '@openagt/skill-github'
import { carriedSkills, SKILL_NAMES, type CarriedSkill } from './catalogue.js'
import { olderThan, unstamped } from './skill-file.js'

/**
 * What a project has, read off its files (#2023): a project has a skill when the skill's text is
 * in it, where the coding agents read it. Nothing else is asked: no `package.json`, no list kept
 * anywhere. A folder deleted by hand is a skill removed.
 */

/** Where `init` writes a skill's text, and where it links it for Claude Code. Codex reads the first. */
export const TEXTS_DIR = '.agents/skills'
export const LINKS_DIR = '.claude/skills'

/**
 * How a skill stands in a project:
 * - `absent`: the project does not hold it.
 * - `current`: its text is the one `init` carries.
 * - `newer`: `init` carries a newer text than the one the project was given.
 * - `changed`: the project's text was changed by hand since `init` wrote it.
 * - `own`: the project holds a text under this name that `init` did not write.
 * - `ahead`: the project's text is from a newer `init` than this one.
 */
export type Standing = 'absent' | 'current' | 'newer' | 'changed' | 'own' | 'ahead'

export interface SkillState {
  name: string
  standing: Standing
  /** The file the project's text is in, from the project's root; absent when the project holds none. */
  file?: string
}

export interface ProjectState {
  skills: SkillState[]
  /** Whether the project's hooks start the scheduler with the dashboard. */
  scheduler: boolean
  /** Whether the folder is a git repository. */
  git: boolean
  /** Whether a dashboard knows the folder as a project: its `.openagent/` is there. */
  activated: boolean
  /** Whether the project has a remote named `origin`. */
  remote: boolean
  /** Whether that remote is on GitHub, the one git host there is a skill for. */
  github: boolean
}

/** The file a project's text of `name` is in, from the project's root: the folder `init` writes first, else Claude Code's. */
async function textFile(root: string, name: string): Promise<string | undefined> {
  for (const dir of [TEXTS_DIR, LINKS_DIR]) {
    const file = `${dir}/${name}/SKILL.md`
    if (await stat(join(root, file)).then(s => s.isFile(), () => false)) return file
  }
  return undefined
}

/** How the project's text of one skill stands against the one `init` carries. */
export function standingOf(file: string, carried: CarriedSkill): Exclude<Standing, 'absent'> {
  // A checkout that turned the line ends into CRLF holds the same text.
  const { version, text } = unstamped(file.replaceAll('\r\n', '\n'))
  if (text === carried.text) return 'current'
  if (version === undefined) return 'own'
  if (olderThan(version, carried.version)) return 'newer'
  return olderThan(carried.version, version) ? 'ahead' : 'changed'
}

export async function readProject(root: string, git: GitRunner = nodeGitRunner()): Promise<ProjectState> {
  const carried = await carriedSkills()
  const skills: SkillState[] = []
  for (const name of SKILL_NAMES) {
    const file = await textFile(root, name)
    if (file === undefined) skills.push({ name, standing: 'absent' })
    else skills.push({ name, standing: standingOf(await readFile(join(root, file), 'utf8'), carried.get(name)!), file })
  }
  const inRepo = await git(['rev-parse', '--is-inside-work-tree'], root).then(out => out.trim() === 'true', () => false)
  const remote = inRepo ? await git(['remote', 'get-url', 'origin'], root).then(out => out.trim(), () => '') : ''
  return {
    skills,
    scheduler: await hasHooks(root),
    git: inRepo,
    activated: await lstat(join(root, OPENAGENT_DIR)).then(entry => entry.isDirectory(), () => false),
    remote: remote !== '',
    github: homeUrlFromRemote(remote) !== undefined,
  }
}

/** The skills a project holds, by name. */
export function held(state: ProjectState): string[] {
  return state.skills.filter(skill => skill.standing !== 'absent').map(skill => skill.name)
}
