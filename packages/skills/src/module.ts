import { nodeGitRunner, linkSkillsInFolder, relinkCheckout, skillLink } from '@openagt/git-branches'
import { type GitRunner, defineModule, RunOrder, type ModuleDefinition, type RunContext } from '@openagt/hooks'
import { leavingOut } from './left-out.js'

/**
 * skills, the module (#2394): a run's skills, linked where its coding agent looks for them, at
 * `RunOrder.SKILLS`. They are the ones the run's modules give it (`run.skills`): every core
 * module's, and those of the plugins on in the project that the run does not go without. Into a
 * session's folder as they are; into a checkout beside the branches skill, hidden from git, with
 * the project's own skills the run leaves out taken out of this checkout alone. A checkout kept
 * from an earlier leg was made by whatever version ran then: its links are brought to what a new
 * one gets. A project's own skill of a name takes the place of the module's: an entry already in
 * the checkout is left as it is.
 */
export function skillsModule(deps: { git?: GitRunner } = {}): ModuleDefinition {
  const git = deps.git ?? nodeGitRunner()
  return defineModule({
    name: 'skills',
    hooks: { 'run.step': [{ order: RunOrder.SKILLS, name: 'link the skills', run: ctx => linkSkills(ctx, git) }] },
  })
}

export default skillsModule()

async function linkSkills(ctx: RunContext, git: GitRunner): Promise<void> {
  const workspace = ctx.workspace
  if (workspace === undefined) return
  const links = await Promise.all(ctx.skills.map(skillLink))
  if (!ctx.project) await linkSkillsInFolder(workspace, links, git)
  else await relinkCheckout(ctx.project.dir, workspace, { skills: links, without: leavingOut(ctx.options.skills?.project, git) }, git)
}
