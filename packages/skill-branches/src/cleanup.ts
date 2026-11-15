import { lstat, readdir, readlink, rmdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { BRANCHES_DIR, nodeGitRunner, repositoryCheckouts, unexcludeFromGit, type GitRunner } from '@openagt/agent-data'
import { reconcileBranchLinks } from './branch-links.js'
import { isAgentBranch } from './branch-names.js'
import { OWN_SKILL, skillLinkPaths, type SkillLink } from './skill-links.js'
import { worktreeDirEntries } from './worktree.js'

/**
 * `cleanup`: what this tool left in a project, removed, for a person who takes the project out of
 * a dashboard and asks for the tool's files to go too. The tool removes its own and nothing else:
 * a dashboard asks for it by the `cleanup` kind the package declares under `openagent` in its
 * package.json, and holds no list of this tool's files.
 *
 * Every agent checkout goes under the reclaim rule, as `prune` does it: one holding uncommitted
 * work stays, named with the reason, and a branch with work on it is never deleted. The checkouts
 * directory goes only once it is empty: whatever else sits in it (another tool's checkout, a
 * person's file) keeps it, each named. Nothing is pushed.
 *
 * The rules that hide this tool's files from git are the repository's, read by every checkout of
 * it, so a rule goes only when this pass removed what it hid and no checkout of the repository
 * still holds such a thing: the rules for the links once no agent checkout is left anywhere, the
 * rule for the directory once no checkout has one.
 */

/** One thing left where it was, by its path from the project's root, and why. */
export interface Kept {
  path: string
  reason: string
}

export interface CleanupOutcome {
  ok: true
  removed: string[]
  kept: Kept[]
}

/**
 * `reclaimOne` removes one agent's checkout under the reclaim rule and answers nothing, or the
 * line saying why it stayed.
 */
export async function cleanup(repo: string, reclaimOne: (agentId: string) => Promise<string | undefined>, git: GitRunner = nodeGitRunner()): Promise<CleanupOutcome> {
  const dir = join(repo, BRANCHES_DIR)
  const removed: string[] = []
  const kept: Kept[] = []
  for (const { agentId, path } of await worktreeDirEntries(repo)) {
    const stayed = await reclaimOne(agentId)
    if (stayed === undefined) removed.push(`${BRANCHES_DIR}/${basename(path)}`)
    else kept.push({ path: `${BRANCHES_DIR}/${basename(path)}`, reason: stayed })
  }
  // The links named after a checkout that just went are stale from this moment.
  await reconcileBranchLinks(repo, { git })

  for (const name of await readdir(dir).catch((): string[] => [])) {
    const path = `${BRANCHES_DIR}/${name}`
    if (kept.some(entry => entry.path === path)) continue
    // This tool's own link, named as the branch a kept checkout is on: it stays with its checkout.
    const target = await readlink(join(dir, name)).catch(() => undefined)
    if (target !== undefined && kept.some(entry => entry.path === `${BRANCHES_DIR}/${target}`)) continue
    kept.push({ path, reason: 'not made by branches' })
  }
  // rmdir, never a recursive remove: a file that appeared since the listing keeps the directory.
  const gone = kept.length === 0 && (await rmdir(dir).then(() => true, () => false))
  if (gone) removed.push(BRANCHES_DIR)
  else if (kept.length === 0 && (await lstat(dir).then(() => true, () => false))) kept.push({ path: BRANCHES_DIR, reason: 'not empty' })

  if (removed.length > 0) {
    const checkouts = await repositoryCheckouts(repo, git).catch(() => undefined)
    if (checkouts) {
      // A link lives in an agent's checkout: with none left in the repository, the rules hide nothing.
      if (!kept.some(entry => isAgentBranch(basename(entry.path))) && !checkouts.some(isAgentCheckout)) {
        for (const path of skillLinkPaths(OWN_SKILL)) await unexcludeFromGit(repo, `/${path}`, undefined, git).catch(() => {})
      }
      if (gone && !(await anyHolds(checkouts, BRANCHES_DIR))) await unexcludeFromGit(repo, `/${BRANCHES_DIR}`, undefined, git).catch(() => {})
    }
  }
  return { ok: true, removed, kept }
}

/**
 * Take back the rules that hide `skills`' links, for a caller that had skills of its own linked
 * into the checkouts (`SkillLink`) and now removes what it left in the project. Under this
 * tool's own rule for its links: a rule goes once no agent checkout is left anywhere in the
 * repository, since every checkout reads the one exclude file.
 */
export async function liftSkillRules(repo: string, skills: readonly SkillLink[], git: GitRunner = nodeGitRunner()): Promise<void> {
  const checkouts = await repositoryCheckouts(repo, git).catch(() => undefined)
  if (!checkouts) return
  if ((await worktreeDirEntries(repo)).length > 0 || checkouts.some(isAgentCheckout)) return
  for (const skill of skills) for (const path of skillLinkPaths(skill)) await unexcludeFromGit(repo, `/${path}`, undefined, git).catch(() => {})
}

/** Whether a checkout of the repository is an agent's: a folder under `.branches/` named as an agent branch. */
function isAgentCheckout(path: string): boolean {
  return basename(dirname(path)) === BRANCHES_DIR && isAgentBranch(basename(path))
}

/** Whether any of `checkouts` holds something at `name`. */
async function anyHolds(checkouts: readonly string[], name: string): Promise<boolean> {
  for (const checkout of checkouts) if (await lstat(join(checkout, name)).then(() => true, () => false)) return true
  return false
}
