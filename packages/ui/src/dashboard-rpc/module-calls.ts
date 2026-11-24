import { contextProjects, resolveProjectPath, runHostOf } from './context.js'
import { accountsByHost, remoteAccount } from './send-as.js'
import { findComputerModule, findProjectModule } from '../project-modules.js'
import { providedDataChanged } from '../store/provided.js'
import { callModuleFunction, computerHost, functionKind, serverHost, type ComputerHostDeps, type ModuleCallResult } from '../dashboard/module-host.js'
import { distributionHooks, distributionSettings, projectRefAt, runRefAt } from '../distribution-hooks.js'
import { SESSIONS_ID } from '../project-address.js'

import { pullProjectData } from '@openagt/agent-data'
import { patchRun } from '@openagt/agent-driver'
import type { ProjectRef, RunFound, RunQuestion, RunRef } from '@openagt/hooks'
import type { ModuleOn } from '@openagt/hooks/rpc'
import { readRunEvents } from '../store/index.js'
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
  const project = projectOnce(projectId, root)
  const host = serverHost(root, await distributionSettings(), {
    ...COMPUTER,
    project,
    find: runsFound(projectId, root),
    questions: agentId => runQuestions(projectId, root, agentId),
    say: (agentId, line) => sayForModule(projectId, root, agentId, line),
    landed: (agentId, landed) => landedFor(root, agentId, landed),
    gitAccess: async remote => (await distributionHooks()).gitAccess(remote),
    modulesOn: async opts => modulesOn(await project(), opts?.every === true),
  })
  const result = await callModuleFunction(module.server, name, host, input)
  if (kind === 'act') {
    await pullProjectData(root, { log: () => {} }).catch(() => {})
    providedDataChanged(root, pkg)
  }
  return result
}

/** What every function is handed of this computer: its projects, and OpenAgent's accounts at the git hosts, as the Permissions page lists them. */
const COMPUTER: ComputerHostDeps = {
  projects: async () => Promise.all((await contextProjects().list()).map(project => projectRefAt(project.id, project.path))),
  accounts: { hosts: accountsByHost, sendAs: remoteAccount },
}

/** The project `projectId` at `root`, as a hook is given it, read once for the call and only when asked: a session with no project is none. */
function projectOnce(projectId: string, root: string): () => Promise<ProjectRef | undefined> {
  let project: Promise<ProjectRef | undefined> | undefined
  return () => (project ??= projectId === SESSIONS_ID ? Promise.resolve(undefined) : projectRefAt(projectId, root))
}

/**
 * The modules on in `project` (none: a session with no project), each with the skills it gives its
 * runs and whether it has a step of them; with `every`, every module of the distribution's.
 */
async function modulesOn(project: ProjectRef | undefined, every: boolean): Promise<ModuleOn[]> {
  const hooks = await distributionHooks()
  const where = project ? { project } : {}
  const [on, given, steps] = await Promise.all([every ? hooks.modules : hooks.on(project), hooks.skills(where, { every }), every ? [] : hooks.steps({ ...where, options: {} })])
  return on.map(module => ({
    name: module.name,
    plugin: module.plugin !== undefined,
    skills: given.filter(skill => skill.module === module.name).map(skill => skill.name),
    steps: every ? module.hooks['run.step'] !== undefined : steps.some(step => step.module === module.name),
  }))
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

/** Write down on run `agentId`'s record, in the project at `root`, that its work was landed: the record is what its page reads once the branch is gone. */
async function landedFor(root: string, agentId: string, landed: { commit: string; from: string }): Promise<void> {
  if (!(await patchRun(root, agentId, { landed }).catch(() => false))) throw new Error('the record was not updated')
}

/** The questions run `agentId` of the project at `root` still waits on, read off its events (as its host says them) by the rule every surface reads them by. */
async function runQuestions(projectId: string, root: string, agentId: string): Promise<RunQuestion[]> {
  const run = await runRefAt(projectId, root, agentId)
  const events = await readRunEvents(await runHostOf(run), run).catch(() => undefined)
  return pendingChoices(events ?? []).map(question => ({ ...question, options: [...question.options] }))
}

/**
 * Call function `name` of the server part of a package that is this computer's, in no project:
 * what such a module keeps is the computer's or the person's (their name and picture), so it is
 * read and changed with no project added, here only. Refused for any other package. After an act,
 * what was read of every project's data is read anew.
 */
async function callComputerModule(pkg: string, name: string, input: unknown): Promise<ModuleCallResult> {
  const module = await findComputerModule(pkg).catch(() => undefined)
  if (!module) return { ok: false, error: `${pkg} is not this computer's` }
  if (!module.server) return { ok: false, error: `${pkg} has no server part` }
  const kind = await functionKind(module.server, name)
  const result = await callModuleFunction(module.server, name, computerHost(await distributionSettings(), COMPUTER), input)
  // What such a module changes may be any project's data, in the person's own folder (what a sync took in): every project's is read anew.
  if (kind === 'act') for (const project of await contextProjects().list().catch(() => [])) providedDataChanged(project.path)
  return result
}
