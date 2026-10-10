import { contextAddProject, contextProjectErrors, contextProjects, contextRemoveProject, resolveProjectPath } from './context.js'
import { readProjectCommands, type ProjectCommand } from '../project-commands.js'
import { DATA_BRANCH, branchReach, originDefaultBranch, pullFileBranch, writeSharing, type BranchReach } from '@openagt/agent-data'
import { readProjectHooks, runCheckHook, startLineTakesBase, type StartReadiness } from '../project-hooks.js'
import { isPublishPick, publishPickIn, type PublishPick } from '../publish-levels.js'
import { hasRemote } from '../has-remote.js'
import { repositoryAddress } from '../repository-address.js'
import { currentBranch } from '../dashboard/git-status.js'
import { waitingSkills } from '../dashboard/start-branch.js'
import { pickDirectory, type PickDirectoryResult } from '../pick-directory.js'
import { projectGitHost } from '../store/git-host.js'
import type { ProjectSummary } from '../dashboard/projects.js'
import type { AddProjectResult, OnboardingSuggestion, RemoveProjectResult } from '../dashboard/types.js'

// The Projects sidebar behind the new dashboard (#405): the global registry (#390) the
// daemon and CLI write — id, path, name, activated, last activity. The per-agent
// foreground dashboard (#427) scopes this to a single project via the request context.
// The live event stream is its own endpoint rather than a call (`GET /_rpc/events`).
//
// Each project also carries what the daemon's background jobs found wrong with it (#1500) —
// a data branch that cannot reach origin, say (#1599) — and why its data stays on this machine, if it does.
// Both ride this list rather than a read of their own because the list is what every project
// surface already polls, so an error reaches the sidebar dot and the project's banner with
// nothing new to subscribe to.
export async function onProjects(): Promise<ProjectSummary[]> {
  const state = contextProjectErrors()
  return (await contextProjects().list()).map(project => {
    const { errors, local } = state(project.path)
    return { ...project, ...(errors.length > 0 ? { errors } : {}), ...(local ? { local } : {}) }
  })
}

/**
 * Add a project from the dashboard (#396/#433): install the repo and register it so it joins the
 * Projects list. Like `sendStart` this needs the daemon (it spawns git + writes the shared
 * registry), so it calls the daemon's own `addProject` closure off the wired dashboard context.
 * Returns the daemon's {@link AddProjectResult}.
 *
 * `share` is the person's answer, asked before the add: whether the agents' records may go to the
 * repository's remote. Nothing is pushed for a project added with `false`.
 */
export async function sendAddProject(path: string, share: boolean): Promise<AddProjectResult> {
  // Throws on an unwired context (D3), like `sendStart`: a missing capability is a wiring bug.
  const addProject = contextAddProject()
  const trimmed = path.trim()
  if (!trimmed) return { ok: false, error: 'a project path is required' }
  return addProject(trimmed, share === true)
}

/**
 * Remove a project from the dashboard: it leaves the Projects list. Nothing in its folder is
 * deleted unless `files` is true: then what OpenAgent left there is removed too, and the answer
 * says what went and what stayed. Like `sendAddProject` this is the daemon's to do (it runs the project's close hooks and
 * writes the shared registry), so it calls the daemon's own closure off the wired dashboard context.
 * Addressed by id and not by path, so a project whose folder is gone can still be removed.
 */
export async function sendRemoveProject(projectId: string, files: boolean): Promise<RemoveProjectResult> {
  const removeProject = contextRemoveProject()
  if (typeof projectId !== 'string' || !projectId) return { ok: false, error: 'a project id is required' }
  return removeProject(projectId, files === true)
}

/** How far the project's records reach right now, read off its repository; `null` when the project is unknown here. */
export async function onRecordsReach(projectId: string): Promise<BranchReach | null> {
  const cwd = await resolveProjectPath(projectId)
  return cwd ? branchReach(cwd) : null
}

/**
 * The person's switch: share the project's records with its remote, or keep them on this machine.
 * Turning it on sends what is there now, so a remote that refuses is said at once, and the switch
 * goes back to off: the records stay where they were. A project with no remote has nothing to
 * share with, and is refused.
 */
export async function sendShareRecords(projectId: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  if (on && !(await hasRemote(cwd))) return { ok: false, error: 'this project has no remote to share with' }
  await writeSharing(cwd, on)
  if (!on) return { ok: true }
  const sent = await pullFileBranch(cwd, DATA_BRANCH, { log: () => {} })
  if (sent.ok) return { ok: true }
  await writeSharing(cwd, false)
  return { ok: false, error: sent.error }
}

/**
 * Open the OS folder picker on the daemon's machine and wait for the user's choice (#1150). The
 * browser cannot learn an absolute path from any picker of its own, and the daemon — which runs on
 * the machine the user is sitting at — can, so the dialog is the daemon's. A dismissed dialog
 * comes back as `path: null`.
 */
export async function sendPickProjectDirectory(): Promise<PickDirectoryResult> {
  return pickDirectory()
}

/**
 * The Onboarding checklist's one server-side fact (#958): the directory this server runs in,
 * so the first step can offer "Add {cwd} as project" without the user typing a path.
 */
export async function onOnboarding(): Promise<OnboardingSuggestion> {
  const cwd = process.cwd()
  const registered = await contextProjects().list()
  return { cwd, cwdProjectId: registered.find(p => p.path === cwd)?.id ?? null }
}

/** What the launcher offers for a project: its commands, and whether a run can be started here at all. */
export interface ProjectLauncher {
  commands: ProjectCommand[]
  /** Whether the project's `.openagent/hooks.yml` has a `start` line; without one Start is off. */
  startHook: boolean
  /** Whether one of the project's packages provides a git host; without one no pull request can be opened, so the publish menu stops at the branch. */
  gitHost: boolean
  /** Whether the project's repository has an `origin` remote; without one nothing can be published, so the publish menu stops at the commit. */
  remote: boolean
  /** The address the project's repository was cloned from, the name another machine knows the project by; absent, the project cannot be sent to one. */
  address?: string
  /**
   * The two branches an agent can start from here, for the launcher's "start from" chip: `main`,
   * the name of origin's default branch, and `local`, the branch the project's folder is on now.
   * Absent where the pick could not be obeyed or has nothing to pick between: the start line does
   * not pass `BASE` on, the repository has no remote, or the folder is on no branch.
   */
  startFrom?: { main: string; local: string }
}

/**
 * The project's commands (#1774), read off its skills folders, whether it has a start hook, whether
 * it has a git host, and the branches an agent can start from. `null` when the project is unknown here.
 */
export async function onCommands(projectId: string): Promise<ProjectLauncher | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const [commands, hooks, gitHost, remote, address, main, local] = await Promise.all([readProjectCommands(cwd), readProjectHooks(cwd), projectGitHost(cwd).catch(() => undefined), hasRemote(cwd), repositoryAddress(cwd), originDefaultBranch(cwd), currentBranch(cwd)])
  // Both read locally, never fetched. `HEAD` is a folder on no branch: there is no local branch to start from.
  const startFrom = hooks.start !== undefined && startLineTakesBase(hooks.start) && remote && main !== undefined && local !== undefined && local !== 'HEAD' ? { main: main.slice('origin/'.length), local } : undefined
  // A skill written into the folder reaches agents once it is on the branch they start from: until then its command is said to be waiting.
  const { waiting } = await waitingSkills(cwd, commands.map(command => command.name))
  const listed = commands.map(command => {
    const waits = waiting.get(command.name)
    return waits ? { ...command, waiting: waits.branch, ...(waits.here ? { here: true as const } : {}) } : command
  })
  return { commands: listed, startHook: hooks.start !== undefined, gitHost: gitHost !== undefined, remote, ...(address ? { address } : {}), ...(startFrom ? { startFrom } : {}) }
}

/**
 * What would stop a run in this project before it spends a checkout, said in the launcher before
 * the Start: the project's `check` hook, given the coding agent picked. A missing CLI or a
 * logged-out one is a problem the run itself would refuse on; a warning is said and blocks nothing.
 * A check line that fails is said as a warning: it is a broken check, not a reason to stop.
 * `null` for an unknown project or one without a check hook: nothing to say.
 */
export async function onStartCheck(projectId: string, driver?: string): Promise<StartReadiness | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const checked = await runCheckHook(cwd, driver !== undefined ? { driver } : {})
  if (checked.ok) return { problems: checked.problems, warnings: checked.warnings }
  return checked.noHook ? null : { problems: [], warnings: [checked.error] }
}

