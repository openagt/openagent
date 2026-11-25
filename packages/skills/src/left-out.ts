import { nodeGitRunner } from '@openagt/git-branches'
import { SKILLS_DIRS } from './project-skills.js'
import type { GitRunner, SkillsOptions } from '@openagt/hooks'

/** Which of the project's own skills a run keeps: every one, none, or the ones named. */
export type ProjectSkillsPick = NonNullable<SkillsOptions['project']>

/**
 * The project's own skills a run leaves out (Rom's design, the session's picks): the texts a
 * project tracks under `.agents/skills/<name>/`, and Claude Code's `.claude/skills/<name>` links to
 * them, as the project commits them or `npx skills add` adds them. A session that leaves some out
 * has them out of its checkout alone (`git-branches`' `leaveOut`): the index keeps them, nothing
 * is committed about it, and the project's other checkouts have them.
 */

/** The names of the project's own skills: every entry git tracks right under either folder. */
export async function projectSkillNames(repo: string, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  const listed = await git(['ls-files', '-z', '--', ...SKILLS_DIRS], repo).catch(() => '')
  const names = new Set<string>()
  for (const file of listed.split('\0').filter(Boolean)) {
    const name = file.split('/')[2]
    if (name) names.add(name)
  }
  return [...names]
}

/**
 * The paths a run's checkout leaves out for the session's pick of the project's skills: the folder
 * of every one not picked, under both dirs; none for every skill. Asked of the checkout itself,
 * once it is there: it starts from origin's branch, and what that holds is what the pick is about,
 * not what the project's folder happens to hold.
 */
export async function leftOutSkillPaths(checkout: string, pick: ProjectSkillsPick | undefined, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  if (pick === undefined || pick === 'all') return []
  const kept = new Set(pick === 'none' ? [] : pick)
  return (await projectSkillNames(checkout, git)).filter(name => !kept.has(name)).flatMap(name => SKILLS_DIRS.map(dir => `${dir}/${name}`))
}

/** What a run's checkout leaves out, for `git-branches` to ask of it: {@link leftOutSkillPaths} for the session's pick. */
export function leavingOut(pick: ProjectSkillsPick | undefined, git: GitRunner = nodeGitRunner()): (checkout: string) => Promise<string[]> {
  return checkout => leftOutSkillPaths(checkout, pick, git)
}
