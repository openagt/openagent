import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import type { ProjectSkillsPick } from './agent.js'

/**
 * The project's own skills (Rom's design, the session's picks): the texts a project tracks under
 * `.agents/skills/<name>/`, and Claude Code's `.claude/skills/<name>` links to them, as the
 * dashboard's Skills page commits them. A session that leaves some out has them out of its
 * checkout alone (`skill-branches`'s `leaveOut`): the index keeps them, nothing is committed about
 * it, and the project's other checkouts have them.
 */

/** Where a project keeps its own skills, from its root. */
export const PROJECT_SKILL_DIRS: readonly string[] = ['.agents/skills', '.claude/skills']

/** The names of the project's own skills: every entry git tracks right under either folder. */
export async function projectSkillNames(repo: string, git: GitRunner = nodeGitRunner()): Promise<string[]> {
  const listed = await git(['ls-files', '-z', '--', ...PROJECT_SKILL_DIRS], repo).catch(() => '')
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
  if (pick === undefined) return []
  const kept = new Set(pick === 'none' ? [] : pick)
  return (await projectSkillNames(checkout, git)).filter(name => !kept.has(name)).flatMap(name => PROJECT_SKILL_DIRS.map(dir => `${dir}/${name}`))
}

/** What a run's checkout leaves out, for `skill-branches` to ask of it: {@link leftOutSkillPaths} for the session's pick. */
export function leavingOut(pick: ProjectSkillsPick | undefined, git: GitRunner = nodeGitRunner()): (checkout: string) => Promise<string[]> {
  return checkout => leftOutSkillPaths(checkout, pick, git)
}
