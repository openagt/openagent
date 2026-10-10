import type { LinkedPr } from './pull-requests.js'
import type { PublishPick } from '../publish-levels.js'

// The dashboard's request/result vocabulary (#345/#396/#475): the shapes the Start / Add /
// Preview RPCs speak. They live here, on neither the HTTP server nor the RPC mount, so both —
// plus the RPCs themselves — depend on this leaf rather than on each other.

/** The outcome of removing a retained worktree (#737). */
export type RemoveWorktreeResult = { ok: true } | { ok: false; error: string }

/** The outcome of deleting a session — its records and worktree (#1032). */
export type DeleteAgentResult = { ok: true } | { ok: false; error: string }

/**
 * The outcome of an add-project attempt (#396): registered, or was already, or why not.
 * `noRemote` says the person asked to share the agents' records and the repository has no remote
 * to share with: they are kept on this machine.
 */
export type AddProjectResult =
  | { ok: true; alreadyActivated: boolean; noRemote?: true }
  | { ok: false; error: string }

/**
 * What removing OpenAgent's files from a project's folder did: what went, what stayed with the
 * reason, and what could not be done, each line in words for a person. Paths are from the
 * project's root.
 */
export interface CleanupReport {
  removed: string[]
  kept: { path: string; reason: string }[]
  failed: string[]
}

/** The outcome of removing a project from the list: gone from it, with what the clean-up did when one was asked for, or why not. */
export type RemoveProjectResult = { ok: true; cleanup?: CleanupReport } | { ok: false; error: string }

/**
 * What the Onboarding checklist (#958) needs and no other read carries: the server's own
 * working directory, offered as the one-click first project.
 *
 * Both fields are null where adding projects is not wired (the relay), so a public host
 * never discloses its filesystem layout.
 */
export interface OnboardingSuggestion {
  /** The server's working directory, or null when it cannot be offered. */
  cwd: string | null
  /** The project id for {@link cwd} when it is already registered, else null. */
  cwdProjectId: string | null
}

/**
 * What a Start carries besides its prompt (#1774): the person's picks, handed to the project's
 * `start` hook line as `DRIVER`, `MODEL`, `PUBLISH` and `BASE`. Absent leaves each to the tool the line names.
 */
export interface StartAgentOptions {
  /** The model to run on. */
  model?: string
  /** Which coding agent the run is on: `claude-code` or `codex`. */
  driver?: string
  /** The person's saved pick of how far the run takes its work when the agent finishes. Absent, none is saved: the daemon starts the run at `commit`. A saved pick the project is not offered is held to the furthest the project goes with no pull request. */
  publish?: PublishPick
  /**
   * The branch the agent's own branch starts from, as this machine has it, commits that are not
   * pushed included: the launcher's "My local branch" pick. Absent, origin's default branch. A
   * word that is no branch name refuses the Start. Not sent to another machine: its branches are its own.
   */
  base?: string
  /**
   * The follow-up's prompt: once the run ends done with a pull request, a fresh agent works its
   * branch from it before the request merges. The launcher's "Post-merge cleanup" box.
   */
  then?: string
  /**
   * Run this session on a saved machine (#1067), named by its id: the local daemon relays the
   * start to that machine's daemon, which starts it in its own copy of the project, and streams
   * its events back into the local agent view. Absent = run on this machine. Stripped before the
   * start is forwarded, so the machine starts an ordinary local run and does not relay onward.
   */
  machine?: string
}

/** The outcome of a Start attempt (#345): the id of the run the project's start hook began, or why there is none. */
export type StartAgentResult = { ok: true; agentId: string } | { ok: false; error: string }

/**
 * Where a session is working (#798): its checkout, its branch, and what it is holding. Read by
 * the dashboard so a session's action bar can say which worktree it has, rather than leaving the
 * user to infer it from an agent id.
 *
 * Only what is true of the run: once its checkout is gone there is no tree to be clean or dirty,
 * so {@link checkout} is absent and the branch is the one the run recorded.
 */
export interface AgentWorktree {
  /** The run's own checkout while it exists. */
  checkout?: {
    /** Absolute path of the checkout. */
    path: string
    /** Uncommitted changes present in it. */
    dirty: boolean
    /** Size on disk, bytes. Only read once nothing is writing to it, and best-effort even then. */
    sizeBytes?: number
  }
  /** The branch the run's work is on: its checkout's while it has one, else the one it recorded. */
  branch?: string
  /** The PR opened for this run's branch (#809), when there is one. */
  pr?: LinkedPr
  /** The PR is not known yet, rather than absent (#1028): the lookup is still running. */
  prPending?: boolean
}
