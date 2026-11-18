import { linkSkillsInFolder, relinkCheckout, type SkillLink } from '@openagt/skill-branches'
import { RunOrder, type RunStep } from '@openagt/hooks'
import type { Leg } from '../leg.js'
import { leavingOut } from '../project-skills.js'

/** skills' step: the run's skills, linked where it works for its coding agent. */
export function skillsSteps(leg: Leg): RunStep[] {
  return [{ order: RunOrder.SKILLS, name: 'link the skills', run: () => linkSkills(leg) }]
}

/**
 * The run's skills, linked where its coding agent looks for them: into a session's folder as they
 * are; into a checkout beside the branches skill, hidden from git, with the project's own skills
 * the run leaves out taken out of this checkout alone. A checkout kept from an earlier leg was made
 * by whatever version ran then: its links are brought to what a new one gets. Skills that cannot be
 * read are none.
 */
async function linkSkills(leg: Leg): Promise<void> {
  const { checkout, here } = leg
  if (!checkout) return
  const skills = await here.skills(leg.repo, leg.driver).catch((): SkillLink[] => [])
  if (checkout.branch === undefined) await linkSkillsInFolder(checkout.path, skills, here.git)
  else await relinkCheckout(leg.repo, checkout.path, { skills, without: leavingOut(leg.mark.projectSkills, here.git) }, here.git)
}
