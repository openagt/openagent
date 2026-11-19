import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { distributionPackages } from '../distribution-packages.js'
import { carriedSkills, descriptionOf, GROUPS } from '../project-skills/catalogue.js'

// What a session can pick under the message box, in the Skills menu: the skills every run gets,
// each of which it can go without, and every other skill the distribution carries, in the Skills
// page's groups, which it can take on top. A run links the same lists, handed down to it
// (`cli/skills.ts`).

/** One skill a session can pick. */
export interface SkillChoice {
  name: string
  /** The one line the skill's text says of itself. */
  description: string
}

export interface SkillChoices {
  /** The skills every run gets, in the distribution's order. */
  everyRun: SkillChoice[]
  /** The other skills carried, in the Skills page's groups. */
  more: { title: string; skills: SkillChoice[] }[]
}

/** The skills every run gets, and the others a session can take on top. */
export async function onSkillChoices(): Promise<SkillChoices> {
  const own = (await distributionPackages()).filter(pkg => pkg.everyRun && pkg.skill !== undefined)
  const everyRun = await Promise.all(own.map(async pkg => ({ name: pkg.skill!, description: descriptionOf(await readFile(join(pkg.dir, 'SKILL.md'), 'utf8').catch(() => '')) })))
  const carried = await carriedSkills()
  const named = new Set(everyRun.map(skill => skill.name))
  const more = GROUPS.map(group => ({ title: group.title, skills: group.skills.flatMap(name => (carried.has(name) && !named.has(name) ? [{ name, description: carried.get(name)!.description }] : [])) }))
  return { everyRun, more: more.filter(group => group.skills.length > 0) }
}
