// The rules of the package's dashboard module (`../dashboard/`), kept apart from React so they
// are unit-tested like the rest of the package: the sentences the pages start agents with, how a
// page finds the agent behind a claim or a plan, how the module's URL reads, what a ticket is as
// a link, which lane of the Overview card a ticket sits in, and how the command's answers are read back.
import { TICKETS_DIR, isTicketFile, queuePriorityForTicket, ticketPlanName } from './names.js'
import type { Ticket, TicketDetail, TicketsMeta } from './tickets.js'

export type { Ticket, TicketDetail, TicketsMeta }

/** The prompt behind "Update tickets": the project's `update-tickets` command, which brings the tickets in line with the issue tracker. One wording for every surface that offers it. */
export const UPDATE_TICKETS_PROMPT = '/update-tickets'

/**
 * The ask for one ticket's plan: `Create tickets/<stem>.plan.md`. The one wording for plan work
 * wherever the module asks for it — the sentence the plan column starts an agent with, and the
 * text a plan is queued as — so a queued copy is recognizable by exact text and the agent that
 * wrote a plan is found by it.
 */
export function planTicketPrompt(file: string): string {
  return `Create ${TICKETS_DIR}/${ticketPlanName(file)}`
}

/** The prompt the start column fires a session with: work on this one ticket, nothing else. */
export function workOnTicketPrompt(file: string): string {
  return `Work on ${TICKETS_DIR}/${file}. Do not start any other ticket.`
}

/** A ticket's plan, repo-relative: `tickets/<stem>.plan.md`, shown beside the way back on the plan page. */
export function planPath(file: string): string {
  return `${TICKETS_DIR}/${ticketPlanName(file)}`
}

/** A run as the dashboard names it to the module: OpenAgent's `ModuleAgent`, by structure. */
export interface AgentLike {
  id: string
  name?: string
  ask?: string
  status: string
  startedAt: string
}

/**
 * The agent that wrote a ticket's plan: the newest whose ask names that plan — the
 * {@link planTicketPrompt} sentence, as the plan column starts it and as a queued plan ask carries
 * it. The plan file carries no marker, so the link is made from the dashboard's runs instead. A
 * plan written by a run whose ask never named it is not attributed.
 */
export function planAgentFor<A extends AgentLike>(agents: readonly A[], file: string): A | undefined {
  const ask = planTicketPrompt(file)
  return agents.filter(agent => agent.ask?.includes(ask)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
}

/**
 * The agent a claim names, when the lock's holder is one of the project's runs: a lock names an
 * agent id — the same id the run's checkout is named with — so a claim a run made resolves to the
 * run's page and its session name; any other holder (another machine's, a branch name) is shown
 * as written by the caller.
 */
export function holderAgent<A extends AgentLike>(agents: readonly A[], lockedBy: string | undefined): A | undefined {
  return lockedBy === undefined ? undefined : agents.find(agent => agent.id === lockedBy)
}

/** Where the module's URL points: the list of tickets, one ticket, or its plan. */
export type ModuleRoute = { view: 'list' } | { view: 'ticket'; projectId: string; file: string } | { view: 'plan'; projectId: string; file: string } | { view: 'unknown' }

/**
 * The module's page from the project the address starts with, if any, and the URL segments after
 * its own: none is the list; a ticket filename in a project is that ticket's page (the dashboard's
 * link convention: `tickets/<file>` in a project opens `/<project>/tickets/<file>`); `plan` after it
 * is the ticket's plan. A ticket with no project, a filename that is not a ticket's, or anything
 * longer, names nothing.
 */
export function routeOf(projectId: string | null, path: readonly string[]): ModuleRoute {
  const [file, plan, ...rest] = path
  if (file === undefined) return { view: 'list' }
  if (projectId === null || !isTicketFile(file) || rest.length > 0) return { view: 'unknown' }
  if (plan === undefined) return { view: 'ticket', projectId, file }
  return plan === 'plan' ? { view: 'plan', projectId, file } : { view: 'unknown' }
}

/** What a path under the tickets directory is called, for a page that shows the path: OpenAgent's `ModuleFileName`, by structure. */
export interface NamedPath {
  title: string
  /** The path opened for it, when it is not the path itself. */
  href?: string
}

/**
 * What each of `paths` is called, by the tickets as listed: a ticket's file is its title; a
 * ticket's plan file (`tickets/<stem>.plan.md`) is "Plan: " and the ticket's title, and opens the
 * ticket, since an entry that names a plan is often the ask to write it. A path that is no
 * ticket's, or whose ticket is not listed (closed, deleted), has no name.
 */
export function namesOf(paths: readonly string[], tickets: readonly { file: string; title: string }[]): Record<string, NamedPath> {
  const titles = new Map(tickets.map(ticket => [ticket.file, ticket.title]))
  const named: Record<string, NamedPath> = {}
  for (const path of paths) {
    if (!path.startsWith(`${TICKETS_DIR}/`)) continue
    const file = path.slice(TICKETS_DIR.length + 1)
    const title = titles.get(file)
    if (title !== undefined) {
      named[path] = { title }
      continue
    }
    const ticket = file.endsWith('.plan.md') ? `${file.slice(0, -'.plan.md'.length)}.md` : undefined
    const planned = ticket === undefined ? undefined : titles.get(ticket)
    if (ticket !== undefined && planned !== undefined) named[path] = { title: `Plan: ${planned}`, href: `${TICKETS_DIR}/${ticket}` }
  }
  return named
}

/** A link as the module hands it to the dashboard's link actions: OpenAgent's `ModuleLink`, by structure. */
export interface TicketAsLink {
  text: string
  href?: string
  priority?: number
}

/** The fields of a ticket a link is made from. */
export interface LinkableTicket {
  file: string
  title: string
  priority?: string | undefined
}

/**
 * The ticket itself as a link: its title, pointing at its file, at the priority its own
 * `Priority:` earns on the 0–10 scale (5 when it has none or an unreadable one). An action on
 * this link names the ticket, so whatever is written links back.
 */
export function ticketLink(ticket: LinkableTicket): TicketAsLink {
  return { text: ticket.title, href: `${TICKETS_DIR}/${ticket.file}`, priority: queuePriorityForTicket(ticket.priority) }
}

/**
 * The ask for the ticket's plan as a link with no target: the plain sentence `Create
 * tickets/<stem>.plan.md`, at the ticket's priority. Deliberately not a link to the ticket: a
 * leading link to a ticket reads everywhere as "this ticket is queued for implementation", and a
 * plan ask must not.
 */
export function planLink(ticket: LinkableTicket): TicketAsLink {
  return { text: planTicketPrompt(ticket.file), priority: queuePriorityForTicket(ticket.priority) }
}

/** What running one command in a project answers: OpenAgent's `ModuleCommandResult`, by structure. */
export type CommandResult = { ok: true; output: unknown } | { ok: false; error: string }

/** The rows `list` printed, or why there are none: a command that could not run, or printed no list. */
export function readListed(result: CommandResult): { tickets: Ticket[] } | { error: string } {
  if (!result.ok) return { error: result.error }
  if (!Array.isArray(result.output)) return { error: 'the tickets command did not print a list' }
  return { tickets: result.output.filter(isTicket) }
}

function isTicket(value: unknown): value is Ticket {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.file === 'string' && typeof row.title === 'string' && typeof row.summary === 'string' && typeof row.date === 'string' && typeof row.planned === 'boolean'
}

/** One ticket as `show` printed it: the ticket with its whole text, its plan when it has one, its holder when claimed. */
export interface ShownTicket {
  ticket: TicketDetail
  plan?: string
  holder?: string
}

/**
 * What `show` answered: the ticket, `null` for a refusal (no such ticket — deleted since the list
 * read, or a stale link), or the error of a command that could not run or printed no ticket.
 */
export function readShown(result: CommandResult): { shown: ShownTicket | null } | { error: string } {
  if (!result.ok) return { error: result.error }
  const answer = result.output as { ok?: unknown; ticket?: unknown; plan?: unknown; holder?: unknown } | null
  if (!answer || typeof answer !== 'object') return { error: 'the tickets command did not print a ticket' }
  if (answer.ok === false) return { shown: null }
  if (!isTicket(answer.ticket) || typeof (answer.ticket as { content?: unknown }).content !== 'string') return { error: 'the tickets command did not print a ticket' }
  return {
    shown: {
      ticket: answer.ticket as TicketDetail,
      ...(typeof answer.plan === 'string' ? { plan: answer.plan } : {}),
      ...(typeof answer.holder === 'string' ? { holder: answer.holder } : {}),
    },
  }
}

/** What `meta` answered: when the tickets last caught up with the tracker; nothing known on any failure. */
export function readMeta(result: CommandResult): TicketsMeta {
  if (!result.ok || !result.output || typeof result.output !== 'object') return {}
  const stamp = (result.output as { lastImportedAt?: unknown }).lastImportedAt
  return typeof stamp === 'string' ? { lastImportedAt: stamp } : {}
}

/** Why no agent is started on a ticket, nor a plan for it, and no page queues it: in review (a `PR:` line) or waiting (a `Waiting:` line). */
export type HeldBack = 'in-review' | 'waiting'

/**
 * Whether a ticket is held back from work, and why: in review, its pull request open, until the
 * tracker update closes it; waiting on something outside the work until a person removes the
 * line. The same rule the tickets skill gives an agent, so a page offers no start, no plan and
 * no queue entry the agent would refuse.
 */
export function heldBack(ticket: { pr?: unknown; waiting?: string | undefined }): HeldBack | undefined {
  if (ticket.pr) return 'in-review'
  if (ticket.waiting) return 'waiting'
  return undefined
}

/** The three lanes of the Overview's hot-tickets card: what an agent holds, what is flagged to do soon, and what waits on a person. */
export type HotLane = 'claimed' | 'high-priority' | 'waiting'

/** Where the ticket format's 0-10 scale starts reading as high. */
const HIGH_PRIORITY_FLOOR = 7

/**
 * Whether a `Priority:` value reads as "do this soon": the format's own scale (`10` acts
 * immediately, `0` only if capacity), so 7 and up qualify. Not the P0/P1 convention, whose
 * low-numbers-first reading is not this format; a word (`high`, `urgent`) is not read either.
 */
export function isHighPriority(priority: string | undefined): boolean {
  const n = Number.parseInt(priority ?? '', 10)
  return !Number.isNaN(n) && n >= HIGH_PRIORITY_FLOOR
}

/**
 * A ticket's lane on the hot-tickets card, or null when it is in neither: claimed, an agent holds
 * it (planning it or implementing it); high-priority, nobody holds it but its priority is high,
 * what a person would likely start next, so never one in review or waiting; waiting, a
 * `Waiting:` line at any priority, since only a person removes it once the wait is over and
 * nothing else reminds them. A claim outranks both: work under way is the fact. Everything else is left off the card, which is a shortlist, not the backlog.
 */
export function hotLane(ticket: { locked?: boolean | undefined; priority?: string | undefined; pr?: unknown; waiting?: string | undefined }): HotLane | null {
  if (ticket.locked) return 'claimed'
  if (ticket.waiting) return 'waiting'
  if (isHighPriority(ticket.priority) && !heldBack(ticket)) return 'high-priority'
  return null
}
