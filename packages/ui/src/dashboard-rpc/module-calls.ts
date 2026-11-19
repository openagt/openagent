import { resolveProjectPath } from './context.js'
import { findComputerModule, findProjectModule } from '../project-modules.js'
import { providedDataChanged } from '../store/provided.js'
import { callModuleFunction, computerHost, functionKind, serverHost, type ModuleCallResult } from '../dashboard/module-host.js'
import { distributionSettings } from '../distribution-hooks.js'
import { relayOr } from './relay-agent.js'
import { pullProjectData } from '@openagt/agent-data'

// A module's functions (`@openagt/hooks/rpc`), which the page calls at `/_rpc/<module>/<name>`
// (rpc-serve.ts) and no other way: this file is none of the RPCs the page calls by name.

export type { ModuleCallResult } from '../dashboard/module-host.js'

/**
 * Call function `name` of a module's server part in one project (`@openagt/hooks/rpc`): how a
 * module's browser part reads, or changes, what a command cannot answer fast enough. Refused for
 * an unknown project, a package that is not a module of that project, and a module with no server
 * part. A call whose input names a run this daemon relays to a saved machine (`input.agentId`) is
 * made over there, by that machine's own copy of the module, since the run's checkout is there;
 * when the machine cannot be asked, a read is answered here, and an act is not made in its place.
 * An act made here is followed as a command's is (`modules.ts`' runModuleCommand): the project's data is
 * converged with origin, and what was read of the package's data is forgotten. With `null` for
 * the project, it is a call of a package that is this computer's ({@link callComputerModule}).
 */
export async function callModule(projectId: string | null, pkg: string, name: string, input: unknown): Promise<ModuleCallResult> {
  if (projectId === null) return callComputerModule(pkg, name, input)
  const agentId = input && typeof input === 'object' && typeof (input as { agentId?: unknown }).agentId === 'string' ? (input as { agentId: string }).agentId : undefined
  const root = await resolveProjectPath(projectId)
  const module = root ? await findProjectModule(root, pkg).catch(() => undefined) : undefined
  const kind = module?.server ? await functionKind(module.server, name) : undefined
  return relayOr<ModuleCallResult>(agentId, 'callModule', [projectId, pkg, name, input], async () => {
    if (!root) return { ok: false, error: 'unknown project' }
    if (!module) return { ok: false, error: `${pkg} is no module of this project` }
    if (!module.server) return { ok: false, error: `${pkg} has no server part` }
    const result = await callModuleFunction(module.server, name, serverHost(root, await distributionSettings()), input)
    if (kind === 'act') {
      await pullProjectData(root, { log: () => {} }).catch(() => {})
      providedDataChanged(root, pkg)
    }
    return result
  }, { ok: false, error: 'the machine this run works on did not answer' }, kind === 'read')
}

/**
 * Call function `name` of the server part of a package that is this computer's, in no project:
 * what such a module keeps is the computer's or the person's (their name and picture), so it is
 * read and changed with no project added, here only. Refused for any other package.
 */
async function callComputerModule(pkg: string, name: string, input: unknown): Promise<ModuleCallResult> {
  const module = await findComputerModule(pkg).catch(() => undefined)
  if (!module) return { ok: false, error: `${pkg} is not this computer's` }
  if (!module.server) return { ok: false, error: `${pkg} has no server part` }
  return callModuleFunction(module.server, name, computerHost(await distributionSettings()), input)
}
