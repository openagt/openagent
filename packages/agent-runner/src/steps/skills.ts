import { linkSkillsInFolder, relinkCheckout, type SkillLink } from '@openagt/skill-branches'
import { defineModule, RunOrder, type RunContext } from '@openagt/hooks'
import { legOf } from '../leg.js'
import { leavingOut } from '../project-skills.js'

/**
 * skills, the module, as far as it is this package's until it has a package of its own: the run's
 * skills, linked where it works for its coding agent.
 */
export const skills = defineModule({
  name: 'skills',
  hooks: { 'run.step': [{ order: RunOrder.SKILLS, name: 'link the skills', run: linkSkills }] },
})

/**
 * The run's skills, linked where its coding agent looks for them: into a session's folder as they
 * are; into a checkout beside the branches skill, hidden from git, with the project's own skills
 * the run leaves out taken out of this checkout alone. A checkout kept from an earlier leg was made
 * by whatever version ran then: its links are brought to what a new one gets. Skills that cannot be
 * read are none.
 */
async function linkSkills(ctx: RunContext): Promise<void> {
  const workspace = ctx.workspace
  if (workspace === undefined) return
  const { here, repo, driver } = legOf(ctx)
  const linked = await here.skills(repo, driver).catch((): SkillLink[] => [])
  if (!ctx.project) await linkSkillsInFolder(workspace, linked, here.git)
  else await relinkCheckout(ctx.project.dir, workspace, { skills: linked, without: leavingOut(ctx.options.skills?.project, here.git) }, here.git)
}
