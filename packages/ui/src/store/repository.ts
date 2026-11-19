import { runPackageCommand } from '@openagt/agent-data'
import { providedCommand } from '../built-in.js'

/**
 * Creating a project's repository on a host, for a project that lives on this machine only. Like
 * every provided kind, OpenAgent names no host: the package that declares
 * `"openagent": { "repository": "<command>" }` creates it, and OpenAgent asks by running that
 * command.
 *
 * The command line a provider answers, each printing one JSON document and exiting 0 (a refusal
 * exits 1 with its reason on stderr):
 *   `<command> create --check`   the repository the project would become, `{ repository, name }`
 *                                (`name` is the host's), creating nothing; refused when the
 *                                project has a remote already or the host cannot be reached
 *   `<command> create`           create it private, set it as the project's origin and push;
 *                                `{ repository, url, name }`
 */

/** The repository a project would become, and the host it would be on. */
export interface RepositoryOffer {
  /** `<account>/<name>`, as the host names it. */
  repository: string
  /** The host's name, for a button: `GitHub`. */
  name: string
}

export type CreateRepositoryResult = { ok: true; url: string } | { ok: false; error: string }

/** What the project's repository provider offers to create, or undefined: no provider, a remote already there, or a host that cannot be reached. */
export async function repositoryOffer(root: string): Promise<RepositoryOffer | undefined> {
  const command = await providedCommand(root, 'repository').catch(() => undefined)
  if (!command) return undefined
  const result = await runPackageCommand(root, command, ['create', '--check'])
  if (!result.ok || !result.output || typeof result.output !== 'object') return undefined
  const { repository, name } = result.output as Record<string, unknown>
  return typeof repository === 'string' && typeof name === 'string' ? { repository, name } : undefined
}

/** Create the project's repository through its provider; a refusal is the provider's own line. */
export async function createRepository(root: string): Promise<CreateRepositoryResult> {
  const command = await providedCommand(root, 'repository').catch(() => undefined)
  if (!command) return { ok: false, error: 'no package of this project creates a repository' }
  const result = await runPackageCommand(root, command, ['create'])
  if (!result.ok) return { ok: false, error: result.error }
  const url = result.output && typeof result.output === 'object' ? (result.output as Record<string, unknown>)['url'] : undefined
  return typeof url === 'string' ? { ok: true, url } : { ok: false, error: `${command.name} created no repository` }
}
