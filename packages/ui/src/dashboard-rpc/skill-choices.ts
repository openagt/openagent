import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectSkillNames } from '@openagt/agent-runner'
import { distributionPackages, type OwnPackage } from '../distribution-packages.js'
import { descriptionOf, GROUPS } from '../skill-catalogue.js'
import { resolveProjectPath } from './context.js'

// What a session can pick under the message box, in the Skills menu: the skills every run gets,
// each of which it can go without, and every other skill the distribution carries, in the menu's
// groups, which it can take on top; then the project's own skills, all, none or each. A run links
// the same lists, handed down to it (`cli/skills.ts`).

/** One skill a session can pick. */
export interface SkillChoice {
  name: string
  /** The one line the skill's text says of itself. */
  description: string
}

export interface SkillChoices {
  /** The skills every run gets, in the distribution's order. */
  everyRun: SkillChoice[]
  /** The other skills carried, in the menu's groups. */
  more: { title: string; skills: SkillChoice[] }[]
}

/** A package's skill as a session picks it: its name, and what its text says of itself. */
async function choiceOf(pkg: OwnPackage & { skill: string }): Promise<SkillChoice> {
  return { name: pkg.skill, description: descriptionOf(await readFile(join(pkg.dir, 'SKILL.md'), 'utf8').catch(() => '')) }
}

/** The skills every run gets, and the others a session can take on top. */
export async function onSkillChoices(): Promise<SkillChoices> {
  const packages = (await distributionPackages()).filter((pkg): pkg is OwnPackage & { skill: string } => pkg.skill !== undefined)
  const everyRun = await Promise.all(packages.filter(pkg => pkg.everyRun).map(choiceOf))
  const named = new Set(everyRun.map(skill => skill.name))
  const more = await Promise.all(
    GROUPS.map(async group => ({
      title: group.title,
      skills: await Promise.all(group.skills.filter(name => !named.has(name)).flatMap(name => packages.filter(pkg => pkg.skill === name).slice(0, 1)).map(choiceOf)),
    })),
  )
  return { everyRun, more: more.filter(group => group.skills.length > 0) }
}

/**
 * The project's own skills, by name, as a run's checkout has them (`agent-runner`'s, which leaves
 * out the ones a session does not pick): what the Skills menu lists and counts. `null` when the
 * project is unknown here.
 */
export async function onProjectSkillNames(projectId: string): Promise<string[] | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  return projectSkillNames(cwd)
}
