import type { RunOptions } from '@openagt/hooks'

import type { PublishPick } from '../publish-levels.js'

// The dashboard's request/result vocabulary (#345/#396/#475): the shapes the Start / Add /
// Preview RPCs speak. They live here, on neither the HTTP server nor the RPC mount, so both —
// plus the RPCs themselves — depend on this leaf rather than on each other.

/** The outcome of deleting a session — its records and worktree (#1032). */
export type DeleteAgentResult = { ok: true } | { ok: false; error: string }

/**
 * The project a folder `openagent` was started in is, on the dashboard's list: the listed project
 * holding the folder, or the folder, added now. `id` always opens its page; `address` is the one
 * the page writes (`src/project-address.ts`).
 */
export interface StartedProject {
  id: string
  path: string
  added: boolean
  address: string
}

/** The {@link StartedProject}, or why the folder could not be added. */
export type StartedInResult = ({ ok: true } & StartedProject) | { ok: false; error: string }

/**
 * What a Start carries besides its prompt: the person's picks, handed to the run's host as the run
 * options, each module's slice (#2394, decision 12). Absent leaves each to the run's own default.
 */
export interface StartAgentOptions {
  /**
   * The run's options as the controls under the message box picked them (`composer.control`): one
   * slice per module, each read by its module's steps, which refuse a slice that is not what they
   * take. What is picked here goes over the picks below.
   */
  options?: RunOptions
  /** The images the prompt goes with, by the names they were kept under (`composer.images`): the agent looks at them with it. Only a run on this computer takes them. */
  images?: string[]
  /** The person's saved pick of how far the run takes its work when the agent finishes. Absent, none is saved: the daemon starts the run at `commit`. A saved pick the project is not offered is held to the furthest the project goes with no pull request. */
  publish?: PublishPick
  /**
   * Where the run runs, by its host's id (`RunHost.id`): one of the hosts beside this computer's of
   * the modules on in the project, such as a CI runner. Absent, this computer. Refused
   * for a session with no project.
   */
  host?: string
}

/** The outcome of a Start attempt (#345): the id of the run the run's host began, or why there is none. */
export type StartAgentResult = { ok: true; agentId: string } | { ok: false; error: string }

