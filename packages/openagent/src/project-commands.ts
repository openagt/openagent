import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { SKILLS_DIRS } from '@openagt/agent-data'

/**
 * A project's commands (#1774): the skills written to be run by a person, read off the folders
 * the coding agents read them from. OpenAgent ships no prompt text; what a project can be
 * asked to do is what its own command skills say. A skill that teaches the agent how to do
 * something (the tickets, the queue) is not a command: typed alone it starts an agent with
 * nothing to do, so the launcher does not list it.
 */

/** One skill as the launcher shows it. */
export interface ProjectCommand {
  /** What is typed after the slash: the skill's folder name. */
  name: string
  /** The `description` of the skill's front matter, when it has one. */
  description?: string
  /** The branch the skill has yet to reach, by name, when its text is in the folder but not on the branch agents start from: an agent started from that branch does not have the command. */
  waiting?: string
  /** With `waiting`: whether the branch the folder is on has the skill, so an agent started from that branch does have the command. */
  here?: true
}

/**
 * The project's commands, by name: the skills whose front matter says
 * `disable-model-invocation: true`, written to be run by a person or a runner and never picked
 * up by the agent on its own. A skill in both folders is listed once. A folder without a
 * readable `SKILL.md` is skipped, and a project with no skills folder has no commands.
 */
export async function readProjectCommands(cwd: string): Promise<ProjectCommand[]> {
  const commands = new Map<string, ProjectCommand>()
  // A skill's first readable copy decides, as with the coding agent: a later folder's copy of a
  // skill already read is not looked at, command or not.
  const read = new Set<string>()
  for (const dir of SKILLS_DIRS) {
    const entries = await readdir(join(cwd, dir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (read.has(entry.name) || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue
      const raw = await readFile(join(cwd, dir, entry.name, 'SKILL.md'), 'utf8').catch(() => undefined)
      if (raw === undefined) continue
      read.add(entry.name)
      const front = frontMatter(raw)
      if (front['disable-model-invocation'] !== true) continue
      commands.set(entry.name, {
        name: entry.name,
        ...(typeof front['description'] === 'string' && front['description'].trim() ? { description: front['description'].trim() } : {}),
      })
    }
  }
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The YAML front matter of a markdown file as a map; none, or one that does not parse, is empty. */
function frontMatter(raw: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (!match) return {}
  try {
    const data: unknown = parseYaml(match[1]!)
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
