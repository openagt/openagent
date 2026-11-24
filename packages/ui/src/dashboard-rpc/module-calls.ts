import { resolveProjectPath, runHostOf } from './context.js'
import { findComputerModule, findProjectModule } from '../project-modules.js'
import { providedDataChanged } from '../store/provided.js'
import { callModuleFunction, computerHost, functionKind, serverHost, type ModuleCallResult } from '../dashboard/module-host.js'
import { distributionHooks, projectRefAt, runRefAt } from '../distribution-hooks.js'
import { SESSIONS_ID } from '../project-address.js'

import { pullProjectData } from '@openagt/agent-data'
import type { ProjectRef, RunFound, RunQuestion, RunRef } from '@openagt/hooks'
import { loadAgentEvents } from '../store/index.js'
import { pendingChoices } from '../open-choices.js'
import { sayForModule } from '../dashboard/run-inbox.js'

// A module's functions (`@openagt/hooks/rpc`), which the page calls at `/_rpc/<module>/<name>`
// (rpc-serve.ts) and no other way: this file is none of the RPCs the page calls by name.

export type { ModuleCallResult } from '../dashboard/module-host.js'

/**
 * Call function `name` of a module's server part in one project (`@openagt/hooks/rpc`): how a
 * module's browser part reads, or changes, what a command cannot answer fast enough. Refused for
 * an unknown project, a package that is not a module of that project, and a module with no server
 * part. An act is followed as a command's is (`modules.ts`' runModuleCommand): the project's data is
 * converged with origin, and what was read of the package's data is forgotten. With `null` for
 * the project, it is a call of a package that is this computer's ({@link callComputerModule}).
 */
export async function callModule(projectId: string | null, pkg: string, name: string, input: unknown): Promise<ModuleCallResult> {
  if (projectId === null) return callComputerModule(pkg, name, input)
  const root = await resolveProjectPath(projectId)
  const module = root ? await findProjectModule(root, pkg).catch(() => undefined) : undefined
  const kind = module?.server ? await functionKind(module.server, name) : undefined
  if (!root) return { ok: false, error: 'unknown project' }
  if (!module) return { ok: false, error: `${pkg} is no module of this project` }
  if (!module.server) return { ok: false, error: `${pkg} has no server part` }
  const host = serverHost(root, await distributionHooks(), {
    project: projectOnce(projectId, root),
    find: runsFound(projectId, root),
    questions: agentId => runQuestions(root, agentId),
    say: (agentId, line) => sayForModule(projectId, root, agentId, line),
  })
  const result = await callModuleFunction(module.server, name, host, input)
  if (kind === 'act') {
    await pullProjectData(root, { log: () => {} }).catch(() => {})
    providedDataChanged(root, pkg)
  }
  return result
}

/** The project `projectId` at `root`, as a hook is given it, read once for the call and only when asked: a session with no project is none. */
function projectOnce(projectId: string, root: string): () => Promise<ProjectRef | undefined> {
  let project: Promise<ProjectRef | undefined> | undefined
  return () => (project ??= projectId === SESSIONS_ID ? Promise.resolve(undefined) : projectRefAt(projectId, root))
}

/**
 * Where a run of the project at `root` has its work, as its host says it: each run as a host is
 * asked about it, made once for the call, which may ask about one run more than once.
 */
function runsFound(projectId: string, root: string): (agentId: string) => Promise<RunFound | undefined> {
  const refs = new Map<string, Promise<RunRef>>()
  return async agentId => {
    let ref = refs.get(agentId)
    if (!ref) refs.set(agentId, (ref = runRefAt(projectId, root, agentId)))
    const run = await ref
    return (await runHostOf(run)).find(run)
  }
}

/** The questions run `agentId` of the project at `root` still waits on, read off its events by the rule every surface reads them by. */
async function runQuestions(root: string, agentId: string): Promise<RunQuestion[]> {
  return pendingChoices((await loadAgentEvents(root, agentId).catch(() => undefined)) ?? []).map(question => ({ ...question, options: [...question.options] }))
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
  return callModuleFunction(module.server, name, computerHost(await distributionHooks()), input)
}
