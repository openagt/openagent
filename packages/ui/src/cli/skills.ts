import { delimiter } from 'node:path'
import { SKILL_CATALOGUE_ENV, SKILLS_ENV } from '@openagt/agent-data'
import { distributionPackages, type OwnPackage } from '../distribution-packages.js'
import { SKILL_NAMES } from '../project-skills/catalogue.js'

/**
 * Put the skills every run gets in `env` under {@link SKILLS_ENV}, and beside them every skill of
 * the Skills page's catalogue, which an agent picks from, under {@link SKILL_CATALOGUE_ENV}: their
 * packages' directories, joined by the path delimiter, as the distribution handed down to this
 * process carries them. The distribution names the ones every run gets (`skill: 'every run'`):
 * what an agent needs in any project to ask the person a question and hand its work over on the
 * project's git host. Each is linked into a run's checkout, hidden from git, and a project's own
 * skill of the same name takes its place (see the runner's `basic-skills.ts`).
 */
export async function handDownSkills(env: NodeJS.ProcessEnv): Promise<void> {
  const packages = await distributionPackages()
  const dirs = (of: readonly OwnPackage[]): string => of.map(pkg => pkg.dir).join(delimiter)
  env[SKILLS_ENV] = dirs(packages.filter(pkg => pkg.everyRun))
  env[SKILL_CATALOGUE_ENV] = dirs(SKILL_NAMES.flatMap(name => packages.filter(pkg => pkg.skill === name)))
}
