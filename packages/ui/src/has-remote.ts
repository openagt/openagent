import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'

/**
 * Whether the repository at `cwd` has an `origin` remote: the one every push and pull request
 * goes to. A remote under another name counts as none, as for the data sync. A directory that is
 * no repository has none.
 */
export async function hasRemote(cwd: string, git: GitRunner = nodeGitRunner()): Promise<boolean> {
  return git(['remote'], cwd).then(out => out.split('\n').some(line => line.trim() === 'origin'), () => false)
}
