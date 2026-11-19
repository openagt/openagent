import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DISTRIBUTION_ENV } from '@openagt/hooks'
import { distributionPackages } from '../distribution-packages.js'

/**
 * The skills a project can pick on the dashboard's Skills page (#2023), in its groups. None is
 * ticked the first time: the person picks what the project needs. The skills every run gets by
 * default are not here (the branches skill, and the ones its command names): they come with every
 * run, with nothing written in the project.
 *
 * Each skill's text is its own package's `SKILL.md`, the package of the distribution whose skill
 * it is, so the dashboard carries the texts of the versions its distribution was published with.
 */

export interface SkillGroup {
  title: string
  skills: readonly string[]
}

export const GROUPS: readonly SkillGroup[] = [
  { title: 'Tickets and queue', skills: ['tickets', 'queue', 'plan', 'plan-tickets', 'triage', 'update-tickets', 'work-queue'] },
  { title: 'Agents', skills: ['logs', 'account-rotation'] },
  { title: 'Pull requests', skills: ['reply'] },
  { title: 'Automations', skills: ['scheduler'] },
  { title: 'Needs its own setup', skills: ['browser', 'discord'] },
]

/** Every skill of the list, in its order. */
export const SKILL_NAMES: readonly string[] = GROUPS.flatMap(group => group.skills)

/**
 * The scheduler's skill: written, it also gets the two lines that start the scheduler while the
 * dashboard is open, in the project's hooks file, which is this machine's and outside git; deleted,
 * it takes them out. Every automation starts switched off, so the scheduler starts no agent until
 * a person says so.
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

/** The texts as read last, by the distribution they were read off. */
let carried: { file: string; skills: Promise<Map<string, CarriedSkill>> } | undefined

/** Every skill of the list with its text, read once per distribution from its packages. Throws for a skill of the list the distribution carries none of. */
export function carriedSkills(): Promise<Map<string, CarriedSkill>> {
  const file = process.env[DISTRIBUTION_ENV] ?? ''
  if (carried?.file !== file) carried = { file, skills: readCarried() }
  return carried.skills
}

async function readCarried(): Promise<Map<string, CarriedSkill>> {
  const packages = await distributionPackages()
  const skills = new Map<string, CarriedSkill>()
  for (const name of SKILL_NAMES) {
    const pkg = packages.find(each => each.skill === name)
    if (!pkg) throw new Error(`the Skills page lists ${name}, a skill the distribution carries none of`)
    const text = await readFile(join(pkg.dir, 'SKILL.md'), 'utf8')
    const description = /^description:[ \t]*(.*)$/m.exec(text)?.[1]?.trim().replace(/^"(.*)"$/, '$1') ?? ''
    skills.set(name, { name, package: pkg.name, version: typeof pkg.manifest.version === 'string' ? pkg.manifest.version : '0.0.0', text, description })
  }
  return skills
}
