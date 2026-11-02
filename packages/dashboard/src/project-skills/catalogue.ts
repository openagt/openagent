import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * The skills a project can pick in the dashboard's Skills list (#2023), in its groups, with what
 * is ticked the first time. Every group is ticked except the skills that are useless until something of
 * their own is set up. The skills every run gets by default are not here (the branches skill,
 * and the ones `@openagt/start` names): they come with every run, with nothing written in the
 * project.
 *
 * Each skill's text is its own package's `SKILL.md`, read from this package's install, so the
 * dashboard carries the texts of the versions it was published with.
 */

export interface SkillGroup {
  title: string
  skills: readonly string[]
  /** Whether the group's skills are ticked in a project that has none of them yet. */
  ticked: boolean
}

export const GROUPS: readonly SkillGroup[] = [
  { title: 'Tickets and queue', ticked: true, skills: ['plan', 'plan-tickets', 'triage', 'update-tickets', 'work-queue', 'suggest-new-tickets', 'suggest-tickets-to-work-on'] },
  { title: 'Reviews and research', ticked: true, skills: ['maintainability', 'maintenance', 'readability', 'security-audit', 'ux', 'research', 'market-research', 'suggest-new-features'] },
  { title: 'Pull requests', ticked: true, skills: ['reply'] },
  { title: 'After a merge', ticked: true, skills: ['post-merge-cleanup'] },
  { title: 'Automations', ticked: true, skills: ['scheduler'] },
  { title: 'Needs its own setup', ticked: false, skills: ['browser', 'discord'] },
]

/** Every skill of the list, in its order. */
export const SKILL_NAMES: readonly string[] = GROUPS.flatMap(group => group.skills)

/**
 * The scheduler's skill: written, it also gets the two lines that start the scheduler while the
 * dashboard is open, in the project's hooks file, which is this machine's and outside git; deleted,
 * it takes them out. Ticked by default: every automation starts switched off, so the scheduler
 * starts no agent until a person says so.
 */
export const SCHEDULER = 'scheduler'

/** One skill as the dashboard carries it. */
export interface CarriedSkill {
  name: string
  /** The package the text is from, and its version: what a written text is stamped with. */
  package: string
  version: string
  /** The whole `SKILL.md`. */
  text: string
  /** The `description` of its front matter, in one line. */
  description: string
}

let carried: Promise<Map<string, CarriedSkill>> | undefined

/** Every skill of the list with its text, read once from this package's own install. */
export function carriedSkills(): Promise<Map<string, CarriedSkill>> {
  return (carried ??= readCarried())
}

async function readCarried(): Promise<Map<string, CarriedSkill>> {
  const require = createRequire(import.meta.url)
  const skills = new Map<string, CarriedSkill>()
  for (const name of SKILL_NAMES) {
    const pkg = `@openagt/skill-${name}`
    const dir = await realpath(dirname(require.resolve(`${pkg}/package.json`)))
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { version: string }
    const text = await readFile(join(dir, 'SKILL.md'), 'utf8')
    const description = /^description:[ \t]*(.*)$/m.exec(text)?.[1]?.trim().replace(/^"(.*)"$/, '$1') ?? ''
    skills.set(name, { name, package: pkg, version: manifest.version, text, description })
  }
  return skills
}
