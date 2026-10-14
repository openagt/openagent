import type { DriverEvent } from '@openagt/agent-driver'

/** One selectable option in an interactive {@link ChoiceRequest} (#304). */
export interface ChoiceOption {
  /** Stable id posted back when this option is picked. */
  id: string
  /** The option shown to the user. */
  label: string
  /** Optional one-line detail under the label (e.g. why an alternative lost). */
  detail?: string
  /** In a multi-select ({@link ChoiceRequest.multi}), whether this option starts checked. Ignored for single-select. */
  default?: boolean
}

/**
 * An interactive choice the agent pauses on until a pick arrives (#304). Emitted as
 * a `choice` {@link OpenAgentEvent}; the dashboard renders it in a panel and posts
 * the pick back. The recommended option is what an agent nobody is watching takes.
 */
export interface ChoiceRequest {
  /** Unique id for this pending choice; the pick is posted back against it. */
  id: string
  /** The question shown above the options (e.g. "Approve this plan?"). */
  title: string
  /** The options to choose between (at least one). */
  options: readonly ChoiceOption[]
  /**
   * The option id pre-selected as the default (taken when nobody is watching). Required
   * for a single-select; omitted for a {@link multi} select, where each option's own
   * {@link ChoiceOption.default} drives the pre-checked set instead.
   */
  recommended?: string
  /**
   * Render as a multi-select checklist (#332): each option is a checkbox pre-checked
   * per its {@link ChoiceOption.default}, and the pick resolves to the selected
   * *subset* of ids rather than one. Absent = the single-select gate (#304).
   */
  multi?: boolean
  /** The markdown file under approval (e.g. `PLAN_<slug>.agent.md`); the doc sidebar renders it. */
  file?: string
}

/** Who resolved a {@link ChoiceRequest}: a human, or a headless auto-accept. */
export type ChoiceBy = 'user' | 'auto'

/** What a {@link import('./agent.js').RunOpenAgentOptions.requestChoice} handler resolves with. */
export interface ChoicePick {
  /** The picked option id, or (for a {@link ChoiceRequest.multi} select) the selected subset of ids. */
  picked: string | readonly string[]
  /** Who picked it. Default `'user'`. */
  by?: ChoiceBy
}

/** Normalize a {@link ChoicePick} (single id or subset) to a list of picked ids. */
export function pickedIds(picked: string | readonly string[]): string[] {
  return Array.isArray(picked) ? [...picked] : picked ? [picked as string] : []
}

/**
 * The single type a run's timeline is read as. OpenAgent emits none of these itself (#1774):
 * a run's tool writes the run's diary, and every line of it is read as one of these so the
 * dashboard and the terminal render one timeline whatever wrote it.
 *
 * What a diary yields today is the agent's own progress (`driver`), the session id it reports
 * (`session-update`), the question a turn ended on (`choice`), what it cost (`usage`) and how it
 * ended (`end`). **The rest of this union is a reading vocabulary for runs recorded before the
 * daemon stopped running agents** — OpenAgent's own narration back then. They are kept
 * because that history is still on the data branch and still has to render.
 *
 * Every event read from a diary line that says when it was written carries that time as `at`
 * (ISO 8601), so the timeline shows the same times live, after a reload, and once the run has
 * ended. Lines written before the diary kept times have none, and show none.
 */
export type OpenAgentEvent = { at?: string } & (
  /**
   * Emitted once at start: which agent is wrapped, the workspace, and a link. `model` is the
   * model id the driver was started with (#1438), recorded per leg — a continuation (#762) emits
   * its own `session` event and may run a different model, so readers fold the latest rather
   * than pinning the first. Absent when the agent left the agent on its own default.
   */
  | { kind: 'session'; driver: string; workspace: string; fake: boolean; sessionLink?: string; model?: string }
  /**
   * Emitted once the wrapped agent reports its real session id (not known at
   * start). Carries the live id and, when a link template was supplied, the
   * resolved URL to jump into that session (#165). Re-emitted if the id changes
   * (each Claude Code prompt is a fresh session), keeping the link current.
   */
  | { kind: 'session-update'; sessionId: string; sessionLink?: string }
  /** What this session was asked for, emitted once as it opens (#211). */
  | { kind: 'intent'; text: string }
  /** The wrapped agent's own progress, forwarded verbatim (never gated on). */
  | { kind: 'driver'; event: DriverEvent }
  /**
   * A live screen something the agent ran is showing: where it answers, on the loopback of the
   * computer the run is on, live while it is the newest open screen at that address and the run
   * has not ended. `label` names what it showed then. The same address with `ended` says the
   * screen has gone. A diary line a command appends itself (agent-driver's `DIARY_ENV`);
   * OpenAgent passes a watcher's calls on to the address (dashboard/screen.ts) and knows nothing
   * of what the screen is.
   */
  | { kind: 'screen'; url: string; label: string; ended?: true }
  /** An OpenAgent-level log line. */
  | { kind: 'log'; message: string }
  /**
   * Something went wrong that only the user can fix (#1500), reported by the agent itself
   * through an `error` block rather than left in prose the reader has to notice. The headline
   * is the first line, the detail is the rest.
   *
   * An event, not a status: it says what happened at this point in the run and stays in the log
   * as history — nothing clears it, because nothing can un-happen it. The project-level errors a
   * background job finds between runs are the other half (project-errors.ts): those are
   * conditions that are true *now*, and clear themselves when the condition is gone.
   */
  | { kind: 'error'; headline: string; detail?: string }
  /**
   * The pull request this session's work is on (E6), the moment one is opened for it.
   *
   * An event for the same reason `branch` is: only an event reaches the agent's meta,
   * and the meta is what every later surface reads. Before this, each of them re-resolved the PR
   * live from the branch — trying the recorded branch, then the session-name branch, then the
   * run-id branch, and filtering the results by whether the PR predated the session — which is a
   * three-way guess plus a timestamp heuristic standing in for one integer nobody had written down.
   */
  | { kind: 'pull-request'; number: number; url: string }
  /**
   * The branch the agent's work is on (#1277), observed off the checkout rather than guessed:
   * emitted at start with the branch the agent actually begins on, and again whenever a later
   * read finds it changed — the agent renames its branch itself, through `branches name`
   * (#1725). Folded to `AgentMeta.branch`, which every surface resolves first — before this event the
   * branch was stamped only at teardown (#799), so any read before that guessed between three
   * naming schemes.
   */
  | { kind: 'branch'; branch: string }
  /**
   * The hand-off anchor a cloud run pushed for its session to clone at (#1601): an empty commit
   * unique to this run, so the branch the session actually works on — a `claude/*` name of the
   * cloud's own choosing, never the designated run branch — is recognizable later by plain
   * ancestry. Folded to `AgentMeta.cloudAnchor`, which the daemon's adoption pass matches
   * against origin's `claude/*` heads once the session has pushed its work.
   */
  | { kind: 'cloud-anchor'; sha: string }
  /**
   * The work has settled and the agent is parked on the user (#785): it stays open as a
   * conversation (#714), so its process is still alive and it still takes messages, but
   * the agent is not doing anything until you say something.
   *
   * Emitted each time the agent parks, and undone by the next `driver` `start` — so "is it
   * working or waiting for me" is answerable from the event log rather than inferred from
   * a status that only changes when the agent ends.
   */
  | { kind: 'settled' }
  /**
   * The price of one turn in USD (#322): the run's record keeps a cost line per turn the
   * coding agent priced, and no token counts, so a turn without a price has no usage event
   * (#540). The dashboard adds them up into its spend readout. Nothing gates on it: an
   * agent already running is never cut short over spending, and the account's quota
   * decides what may *start* instead.
   */
  | { kind: 'usage'; costUsd: number }
  /**
   * The agent paused on an interactive choice (#304) and is awaiting a pick. The
   * dashboard renders the options with the recommended default pre-selected and
   * posts the pick back; a headless agent auto-accepts the recommended option.
   */
  | ({ kind: 'choice' } & ChoiceRequest)
  /** A pending {@link ChoiceRequest} was resolved — the agent continues on `picked` (one id, or the selected subset). */
  | { kind: 'choice-resolved'; id: string; picked: string | readonly string[]; by: ChoiceBy }
  /**
   * The agent finished. `ok` is false when it threw. `stopped` marks the common,
   * non-error case where the user interrupted it (the dashboard Stop button /
   * Ctrl+C), so a surface can show "stopped" rather than "failed".
   */
  | { kind: 'end'; ok: boolean; stopped?: boolean; waiting?: boolean; detail?: string }
)
