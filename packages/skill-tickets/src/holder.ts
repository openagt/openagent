import { AGENT_ID_ENV, checkoutRoot, nodeGitRunner, type GitRunner } from '@openagt/agent-data'

/** Who claims, or that nobody can: see {@link holderOf}. */
export type Holder = { ok: true; holder: string } | { ok: false; reason: 'no-identity' }

/**
 * Who the command claims as, read from where it runs — nothing for the agent to type or know.
 *
 * `AGENT_ID` in the environment when the process that started the agent set it: the id names the
 * agent for its whole life, unlike its branch, which is renamed once the agent names its session —
 * a lock naming the branch would go stale at the first rename. Anywhere else the holder is the
 * current branch name: a cloud session on its own branch, a person on a feature branch. A detached
 * HEAD names nobody.
 */
export async function holderOf(cwd: string, git: GitRunner = nodeGitRunner(), env: NodeJS.ProcessEnv = process.env): Promise<Holder> {
  const id = env[AGENT_ID_ENV]?.trim()
  if (id) return { ok: true, holder: id }
  const checkout = await checkoutRoot(cwd, git)
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], checkout).catch(() => '')).trim()
  return branch && branch !== 'HEAD' ? { ok: true, holder: branch } : { ok: false, reason: 'no-identity' }
}
