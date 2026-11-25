import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Where coding agents read a project's skills: Claude Code's folder, and the shared one Codex reads. */
export const SKILLS_DIRS = ['.claude/skills', '.agents/skills'] as const

/**
 * A project's own skills (#2394, its agent skills): the ones its repository keeps where the
 * coding agents read them, committed or added with `npx skills add`. OpenAgent lists them, offers
 * the ones written to be run by a person as commands, and lets a run leave some out. It never
 * installs, writes or updates them.
 */

/** One of the project's own skills, as its folder holds it. */
export interface ProjectSkill {
  /** What a coding agent lists it by, and what a command is typed as after the slash: its folder's name. */
  name: string
  /** The `description` of its front matter, when it has one: the line an agent reads to decide when to use it. */
  description?: string
  /**
   * Whether it is a command: written to be run by a person or a runner, never picked up by the
   * agent on its own (`disable-model-invocation: true`). Typed alone, a skill that teaches the agent
   * how to do something (the tickets, the queue) would start an agent with nothing to do.
   */
  command: boolean
}

/** The name a skill's folder can have: one a coding agent lists, and a slash command can be typed as. */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/

/**
 * The project's own skills in the folder at `root`, by name: every folder under the coding agents'
 * skills folders with a `SKILL.md` that can be read. A skill in both folders is listed once, and its
 * first readable copy decides, as with the coding agent: a later folder's copy of a skill already
 * read is not looked at. A project with no skills folder has none.
 */
export async function readProjectSkills(root: string): Promise<ProjectSkill[]> {
  const skills = new Map<string, ProjectSkill>()
  for (const dir of SKILLS_DIRS) {
    const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (skills.has(entry.name) || !SKILL_NAME.test(entry.name)) continue
      const text = await readFile(join(root, dir, entry.name, 'SKILL.md'), 'utf8').catch(() => undefined)
      if (text === undefined) continue
      const front = frontMatter(text)
      const description = typeof front['description'] === 'string' ? front['description'].trim() : ''
      skills.set(entry.name, { name: entry.name, ...(description ? { description } : {}), command: front['disable-model-invocation'] === true })
    }
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The YAML front matter of a markdown file as a map; none, or one that does not parse, is empty. */
function frontMatter(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return {}
  try {
    const data: unknown = parseYaml(match[1]!)
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
