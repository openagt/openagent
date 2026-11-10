import { nodeGitRunner, type GitRunner, BRANCHES_DIR, excludeFromGit } from '@openagt/agent-data'
import { agentBranchName } from './branch-names.js'
import { addWorktree, attachWorktree, leaveOut, type AddedWorktree, type LeaveOut } from './worktree.js'
import { linkDependencies } from './worktree-deps.js'
import { reconcileBranchLinks } from './branch-links.js'
import { linkSkill, type SkillLink } from './skill-links.js'

/**
 * A checkout as an agent gets it (#1725): the worktree, `.branches/` hidden from git, the parent's
 * dependency trees linked in, the skill linked in where the agent's harness looks for it (#1739),
 * and the `.branches/` links brought up to date — one sequence, whichever surface asks for it (a
 * scheduler starting a run, the command line).
 */

/** Other skills to link into the checkout beside this package's own (see `SkillLink`), and what of the project's own stays out of it, asked of the checkout (`leaveOut`). */
export interface CheckoutSkills {
  skills?: readonly SkillLink[]
  without?: LeaveOut
}

/** A new agent's checkout, on a fresh `agent-<id>` branch from `base` or origin's default branch. */
export async function createCheckout(
  repo: string,
  opts: { agentId: string; base?: string } & CheckoutSkills,
  git: GitRunner = nodeGitRunner(),
): Promise<AddedWorktree> {
  const worktree = await addWorktree(repo, { agentId: opts.agentId, branch: agentBranchName(opts.agentId), ...(opts.base ? { base: opts.base } : {}), ...(opts.without ? { without: opts.without } : {}) }, git)
  await settle(repo, worktree.path, git, opts.skills)
  return worktree
}

/** A continued agent's checkout, back on the branch its work is on; a branch gone everywhere starts again from `base`, or origin's default branch. */
export async function attachCheckout(
  repo: string,
  opts: { agentId: string; branch: string; base?: string } & CheckoutSkills,
  git: GitRunner = nodeGitRunner(),
): Promise<AddedWorktree> {
  const worktree = await attachWorktree(repo, { agentId: opts.agentId, branch: opts.branch, ...(opts.base ? { base: opts.base } : {}), ...(opts.without ? { without: opts.without } : {}) }, git)
  await settle(repo, worktree.path, git, opts.skills)
  return worktree
}

/**
 * The links of a checkout that is already there, brought to what a new one gets: the package's
 * command and skill, and the caller's skills, and the paths it leaves out set again. For a continued agent whose checkout stayed, made by
 * whatever version ran then. A link that is there is left alone, so this is safe to ask again.
 */
export async function relinkCheckout(repo: string, path: string, opts: CheckoutSkills = {}, git: GitRunner = nodeGitRunner()): Promise<void> {
  await leaveOut(path, opts.without, git)
  await linkSkill(repo, path, opts.skills, git)
}

/**
 * What a checkout gets besides its files. All best-effort: the checkouts are the package's state
 * and hidden from the project's git the moment the first one exists (#1600) — as an untracked
 * directory at the root, `.branches/` would ride any sweeping `git add -A` onto a code branch —
 * through the repository's own exclude file, so no tracked file changes; `node_modules` is
 * gitignored, so a fresh checkout has none and a link that cannot be made is a worse run, not a
 * failed one; the package and its command are linked into a checkout that has neither, so the skill's
 * `npx @openagt/skill-branches@0.1` runs this copy and downloads nothing (`command-link.ts`); a link under `.branches/` is a view, and the next reconcile pass makes it.
 */
async function settle(repo: string, path: string, git: GitRunner, skills: readonly SkillLink[] = []): Promise<void> {
  await excludeFromGit(repo, `/${BRANCHES_DIR}`, undefined, git).catch(() => {})
  await linkDependencies(repo, path).catch(() => [])
  // After the project's own tools: a project that installed this package keeps its copy of the command.
  await linkSkill(repo, path, skills, git)
  await reconcileBranchLinks(repo, { git }).catch(() => {})
}
