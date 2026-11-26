import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { HARNESS_SKILL_DIRS, linkSkill, linkSkillsInFolder, nodeGitRunner, relinkCheckout, sessionCopies, sessionFolder, skillLink, type SkillLink } from '@openagt/git-branches'
import { type GitRunner, defineModule, RunOrder, sessionsHome, type ModuleDefinition, type RunContext } from '@openagt/hooks'
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
 *
 * Then the skills of the run's copies of other repositories (their own `.claude/skills` and
 * `.agents/skills`), linked beside them the same way, so the agent working on several repos has
 * each repo's skills: a skill of a name already there (the project's own, or a module's) wins.
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
  const fromCopies = await copySkills(ctx.id, sessionsHome())
  if (fromCopies.length === 0) return
  if (!ctx.project) await linkSkillsInFolder(workspace, fromCopies, git)
  else await linkSkill(ctx.project.dir, workspace, fromCopies, git)
}

/**
 * The skills of the run's copies of other repositories, each by its name, the first copy's of a
 * name kept: every folder of a copy's `.claude/skills` or `.agents/skills` that holds a SKILL.md.
 */
export async function copySkills(agentId: string, home: string): Promise<SkillLink[]> {
  const folder = sessionFolder(home, agentId)
  const found = new Map<string, SkillLink>()
  for (const copy of await sessionCopies(agentId, home).catch(() => [])) {
    for (const dir of HARNESS_SKILL_DIRS) {
      const root = join(folder, copy, dir)
      for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (found.has(entry.name) || !(entry.isDirectory() || entry.isSymbolicLink())) continue
        if (existsSync(join(root, entry.name, 'SKILL.md'))) found.set(entry.name, { name: entry.name, dir: join(root, entry.name) })
      }
    }
  }
  return [...found.values()]
}
