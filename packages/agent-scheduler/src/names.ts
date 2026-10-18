/** The names the package hangs off. No node imports. */

/** The tool's own directory at the repository root, hidden from git by the tool itself. */
export const STATE_DIR = '.agent-scheduler'

/** The state the tool writes for this user: on or off, the model, the last tick and what it decided. */
export const STATE_FILE = 'state.json'

/**
 * Under the state directory: the automations a person keeps on this machine alone, one file each
 * (`<name>.md`), written like a skill's file. Never tracked, never in a run's checkout.
 */
export const OWN_AUTOMATIONS_DIR = `${STATE_DIR}/automations`

/** The longest text an automation kept on this machine may have, in characters: it travels to its run as one command-line argument. */
export const OWN_TEXT_MAX = 32_000

/** Under the state directory: the scheduler's own log. */
export const SCHEDULER_LOG = 'scheduler.log'

/** The coding agents a scheduled run can be on, by the names `agent-runner` takes. */
export const AGENTS = ['claude-code', 'codex'] as const

/** One of the coding agents a scheduled run can be on. */
export type AgentName = (typeof AGENTS)[number]

/** Whether a value names a coding agent a scheduled run can be on. */
export function isAgent(value: unknown): value is AgentName {
  return (AGENTS as readonly unknown[]).includes(value)
}

/** A coding agent's name for a person. */
export const AGENT_LABELS: Readonly<Record<AgentName, string>> = { 'claude-code': 'Claude Code', codex: 'Codex' }

/**
 * Where each coding agent reads a project's skills. A skill that is only in another agent's folder
 * is no command to it: sent with a slash, it finds nothing to do.
 */
export const AGENT_SKILLS_DIR: Readonly<Record<AgentName, string>> = { 'claude-code': '.claude/skills', codex: '.agents/skills' }

/** The coding agent a scheduled run is on where neither its skill nor a person names one, when it can read the skill. */
export const DEFAULT_AGENT: AgentName = 'claude-code'

/** Where a shared automation is saved, and the first folder the schedule is read from: the skills folder of the agent a run is on by default. */
export const RUN_SKILLS_DIR = AGENT_SKILLS_DIR[DEFAULT_AGENT]

/** A skill's file inside its folder: its front matter may hold the skill's `schedule`. */
export const SKILL_FILE = 'SKILL.md'

/** How far a run of a scheduled command publishes on a machine where nobody picked a level for it: it commits its work and pushes nothing. */
export const DEFAULT_PUBLISH = 'commit'

/** The model a scheduled run on Claude Code starts on when the state names none. */
export const DEFAULT_MODEL = 'opus'

/**
 * How far past the spend boundary unattended work may go, in percentage points: half a day of
 * the week's allowance, the same cushion OpenAgent's daemon used.
 */
export const DEFAULT_SPEND_OFFSET = 100 / 14

/** Runs of one command in flight at once, where neither its skill nor a person names a number. */
export const DEFAULT_CAP = 1

/** The most runs of one command a skill or a person may let be in flight at once. */
export const MAX_AGENTS = 99

/** Whether a value is a number of agents at once: a whole number from 1 to 99. */
export function isAgents(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_AGENTS
}

/** The name a check reads the time of its command's last start under (`$LAST_RUN`). */
export const LAST_RUN_ENV = 'LAST_RUN'

/** Whether a value is a time as the tools write one: an ISO date and time a date reads (`2026-10-09T10:00:00.000Z`). What a switched-on command's switch holds, and a run record's start. */
export function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))
}

/** The longest name a person's own automation may have: a folder name, and a command a person types. */
export const MAX_NAME = 64

/**
 * Whether a text can name a person's own automation: lower-case letters, digits and dashes, a
 * letter or a digit first, and never three dashes in a row, which end a skill file's front matter
 * for a coding agent wherever they stand.
 */
export function isCommandName(text: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(text) && !text.includes('---')
}

/** How long a tick waits for origin's default branch to be fetched before it starts a run: the wait a run's own checkout gives the same fetch. */
export const START_POINT_FETCH_MS = 5_000

/** How often a started scheduler ticks. */
export const TICK_MS = 60_000

/** How much of what a check printed a run is handed, in characters: enough for a list of work, short of a prompt nobody can read. */
export const FOUND_MAX = 8_000

/** How far back a check asks from when nothing says since when: a line that is only being tried, and a command started by hand that never started and is switched off. "Since now" would never find anything. */
export const NEVER_STARTED_SINCE_MS = 24 * 60 * 60 * 1000

/** How long a check that is only being tried may run: less than a tick gives one, and less than a dashboard waits for a command's answer. */
export const TRY_TIMEOUT_MS = 20_000

/** How long a command started by hand may take to get ready, its pull, its check and its readings: past it nothing is written and nothing starts, since a dashboard ends a command at 30 seconds and the marker and the start are still to come. */
export const NOW_READY_MS = 20_000

/** How long the check of a command started by hand may run: whoever asked, a dashboard, waits for the whole answer, the pull and the start with it. */
export const NOW_CHECK_TIMEOUT_MS = 10_000

/** How long a command's check may run before it counts as failed. */
export const CHECK_TIMEOUT_MS = 60_000

/** How long the coding agent may take to write a shell line from a person's words: one turn with no tools takes seconds, and a dashboard ends a command at 30. */
export const WRITE_LINE_TIMEOUT_MS = 25_000
