// The rules of the package's dashboard module (`../dashboard/`), kept apart from React so they
// are unit-tested like the rest of the package: how a queue entry reads on screen, what the
// "Add to queue" action runs for the links a dashboard page hands it, and how the Overview card
// starts agents on entries.

/**
 * The command that works the queue by itself, as a person types it without its slash: the
 * `work-queue` skill's. The Queue page looks for it among the commands a project starts by
 * itself, to say whether anything takes from the queue.
 */
export const QUEUE_COMMAND = 'work-queue'

/** The priorities an entry can be queued at, most urgent first: the sections of the queue file. */
export const PRIORITIES: readonly number[] = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]

/** The priority the page's "Add to queue" starts at: the middle of the scale. */
export const DEFAULT_PRIORITY = 5

/** What the two ends of the scale mean, in the queue file's own words; nothing for a priority between them. */
export function priorityMeaning(priority: number): string | undefined {
  return priority === 10 ? 'most urgent' : priority === 0 ? 'only if there is capacity' : undefined
}

/**
 * The `queue add` command line for a text typed on the page, at the priority picked. The text
 * comes after `--`: a person may type a task that opens with a dash, and it is still the task,
 * never a flag.
 */
export function addTextArgs(text: string, priority: number): string[] {
  return ['add', '--priority', String(priority), '--', text.trim()]
}

/** The `queue done` command line that removes one entry, as the queue printed it; after `--`, since an entry may open with a dash. */
export function doneArgs(entry: string): string[] {
  return ['done', '--', entry]
}

/**
 * Whether an agent that was asked `ask` is on `entry`: it was asked exactly what the start
 * buttons of the page and of the card ask for that entry. An entry that is only a part of what
 * another agent was asked is not being worked on. An agent the command that works the queue
 * started is not known here: it is asked the command alone, and picks its entry itself.
 */
export function isWorkingOn(ask: string | undefined, entry: string): boolean {
  return ask !== undefined && entry.trim() !== '' && ask.trim() === workOnEntryPrompt(entry.trim()).trim()
}

/** How one queue entry reads on a dashboard: what to show, and where it points, if anywhere. */
export interface EntryLabel {
  /** The text to show: a leading markdown link's text, else the whole entry. */
  text: string
  /** The link's target when the entry leads with a link to an absolute http(s) URL; nothing else opens anywhere. */
  url?: string
}

/** `[text](target)` at the very start of an entry: where a caller that queues a link writes it. */
const LEADING_LINK = /^\s*\[([^\]]+)\]\(([^)\s]+)\)/

/**
 * What one entry should read as. Only a link at the START of the entry is its title: that is
 * where a queued link is written, and a link further in is part of a sentence. Anything after the
 * link is a note, kept in the raw entry (shown on hover). An absolute http(s) target opens; any
 * other target (a path inside the repository) is a name the dashboard has no page for here, so
 * the label keeps the text and points nowhere.
 */
export function entryLabel(entry: string): EntryLabel {
  const link = LEADING_LINK.exec(entry)
  if (!link) return { text: entry.trim() }
  const text = link[1]!.trim()
  const target = link[2]!
  return /^https?:\/\//.test(target) ? { text, url: target } : { text }
}

/** A link as a dashboard page hands it to an action: OpenAgent's `ModuleLink`, by structure. */
export interface LinkToQueue {
  text: string
  href?: string
  priority?: number
}

/** The line one link is queued as: a markdown link when it points somewhere, its plain text otherwise. */
export function queueLine(link: LinkToQueue): string {
  return link.href ? `[${link.text}](${link.href})` : link.text
}

/** The `queue add` command line for one link: its line, in its priority's section when it has one. */
export function addArgs(link: LinkToQueue): string[] {
  return ['add', queueLine(link), ...(link.priority !== undefined ? ['--priority', String(link.priority)] : [])]
}

/** What running one command in a project answers: OpenAgent's `ModuleCommandResult`, by structure. */
export type CommandResult = { ok: true; output: unknown } | { ok: false; error: string }

/** What the action did: every link queued, or stopped at the first that was not, with why. */
export type AddOutcome = { ok: true } | { ok: false; error: string }

/** The target of an entry's leading link, when it leads with one: where a queued link points. */
export function entryTarget(entry: string): string | undefined {
  return LEADING_LINK.exec(entry)?.[2]
}

/**
 * Whether a link is already on the queue: a link that points somewhere is queued when an open
 * entry leads with a link to the same target, whatever its text or the note after it; plain text
 * is queued when an open entry is exactly that text. The queue knows nothing of what a target
 * names, only that two entries pointing at the same place are the same work.
 */
export function alreadyQueued(entries: readonly string[], link: LinkToQueue): boolean {
  return link.href !== undefined ? entries.some(entry => entryTarget(entry) === link.href) : entries.some(entry => entry.trim() === link.text.trim())
}

/**
 * Queue the links, in order, in one project, each as one `queue add`, after one read of the open
 * entries (the bare command, origin's copy) so that a link already queued is left as it is: "add"
 * means the set ends up queued, and a second entry would outlive the first's check-off as open
 * work naming something done. Stops at the first failure: a command that could not run, or one
 * that answered a refusal (`{ ok: false, reason }`), whose reason is the error.
 */
export async function addToQueue(run: (args: string[]) => Promise<CommandResult>, links: readonly LinkToQueue[]): Promise<AddOutcome> {
  if (links.length === 0) return { ok: true }
  const listed = await run([])
  if (!listed.ok) return { ok: false, error: listed.error }
  const entries = Array.isArray(listed.output) ? listed.output.filter((entry): entry is string => typeof entry === 'string') : []
  for (const link of links) {
    if (alreadyQueued(entries, link)) continue
    const result = await run(addArgs(link))
    if (!result.ok) return { ok: false, error: result.error }
    const refusal = result.output as { ok?: unknown; reason?: unknown } | null
    if (refusal && typeof refusal === 'object' && refusal.ok === false)
      return { ok: false, error: typeof refusal.reason === 'string' ? `the queue refused: ${refusal.reason}` : 'the queue refused' }
  }
  return { ok: true }
}

/**
 * The prompt an agent is started with for one open entry, from the card's play button and its
 * fan-out: work that one entry through the `queue` skill, take it off the queue once the work is
 * published, and start no other. The raw entry line, not its label: the agent must name exactly
 * this entry to take it off, and the line's link is how it opens what the entry names.
 */
export function workOnEntryPrompt(entry: string): string {
  return `Use the \`queue\` skill: work on this one open queue entry only, and when the work is done and published run \`queue done "<the entry>"\`. Do not start any other entry. The entry:\n\n${entry}`
}

/** How many agents a project's fan-out starts until its count says otherwise. */
export const DEFAULT_FAN_OUT_COUNT = 3

/** The entries a fan-out takes: the top of the queue, as many as the count says, never more than there are. */
export function topEntries(entries: readonly string[], count: number): string[] {
  return entries.slice(0, Math.max(1, count))
}

/** What the fan-out button promises, sized to what a click would actually start. */
export function fanOutLabel(count: number): string {
  return count === 1 ? 'Spin up an agent working on the top entry' : `Spin up ${count} agents working on the top ${count} entries`
}

/** What starting one run answered: OpenAgent's `StartRunResult`, by structure. */
export type StartOutcome = { ok: true; agentId: string } | { ok: false; error: string }

/**
 * Start one run per entry, in order, each pinned to its own entry: several agents told "the first
 * open entry" would all implement the same one. One after another, since each start answers an id
 * of its own; the batch ends at the first refusal, whose reason is the outcome's, and whatever
 * refused this start is not going to take the next one a moment later.
 */
export async function fanOut(start: (prompt: string) => Promise<StartOutcome>, entries: readonly string[]): Promise<{ started: string[]; error?: string }> {
  const started: string[] = []
  for (const entry of entries) {
    const result = await start(workOnEntryPrompt(entry))
    if (!result.ok) return { started, error: result.error }
    started.push(result.agentId)
  }
  return { started }
}
