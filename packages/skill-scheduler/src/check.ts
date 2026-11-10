import { execFile } from 'node:child_process'
import { FOUND_MAX, LAST_RUN_ENV, NEVER_STARTED_SINCE_MS, SWITCHED_ON_ENV, TRY_TIMEOUT_MS } from './names.js'
import { commandPrompt, type ScheduledCommand } from './schedule.js'

/**
 * A command's check (#1774): the shell line its skill gives as `when`, run through the shell at
 * the repository root, told when its command last started (`$LAST_RUN`) and when it was switched
 * on here (`$SWITCHED_ON`). What it prints says whether the command is due and, for a row with
 * `each`, which runs to continue or start. A run the check started is handed what it printed,
 * after its command and apart from it; a person trying a line is shown it the same way.
 */

/** What a check said. */
export interface CheckResult {
  ok: boolean
  stdout: string
  stderr: string
}

/**
 * Run a check at the repository root through the shell, within its budget; the check reads
 * `lastRun` as `$LAST_RUN`, and `switchedOn` as `$SWITCHED_ON` when given. `account` is the
 * environment of the account runs work as at the git host, so a check that asks `gh` asks as it.
 */
export function runCheck(repo: string, shell: string, timeoutMs: number, lastRun: string, switchedOn?: string, account: Record<string, string> = {}): Promise<CheckResult> {
  return new Promise<CheckResult>(resolve => {
    const child = execFile('sh', ['-c', shell], { cwd: repo, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...account, [LAST_RUN_ENV]: lastRun, ...(switchedOn !== undefined ? { [SWITCHED_ON_ENV]: switchedOn } : {}) } }, (err, stdout, stderr) => {
      // A check ended for running out of its time says so: what it had printed to then says nothing of why it failed.
      const why = err?.killed ? `it took longer than ${timeoutMs / 1000} seconds` : err && !String(stderr).trim() ? err.message : String(stderr)
      resolve({ ok: !err, stdout: String(stdout), stderr: why })
    })
    // Nobody types to a check: one that reads its input finds it at its end at once, where it would wait out its whole budget.
    child.stdin?.end()
  })
}

/**
 * The time a check is given as `$LAST_RUN`: an ISO time in UTC to the whole second
 * (`2026-10-09T10:00:00Z`), the shape `gh --search`, a GitHub `since` and `jq`'s `fromdate` all
 * read. The fraction of a second is dropped, never rounded up: a thing that came in that same
 * second is found twice rather than never.
 */
export function lastRunValue(iso: string): string {
  return new Date(Math.floor(Date.parse(iso) / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}

/** Since when a check asks where nothing says since when, ISO: {@link NEVER_STARTED_SINCE_MS} before `now`. */
export function neverStartedSince(now: Date): string {
  return new Date(now.getTime() - NEVER_STARTED_SINCE_MS).toISOString()
}

/**
 * Whether a check's output says the command is due (#1774): the output parsed as JSON is
 * something other than empty — `[]`, `{}`, `null`, `false`, `""`, `0` and no output at all are not
 * due. Every skill command prints JSON on stdout, so a check like `npx @openagt/skill-queue@0.1` needs no piping.
 * Output that is not JSON counts by its text: anything non-blank is due.
 */
export function isDue(stdout: string): boolean {
  const text = stdout.trim()
  if (!text) return false
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return true
  }
  if (value === null || value === false || value === '' || value === 0) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return true
}

/** An item a row with `each` printed: a run to continue, with its words. */
export interface ResumeItem {
  run: string
  text: string
}

/** An item a row with `each` printed: what a new run is for, its words, and the branch it works on when one is named. */
export interface StartItem {
  for: string
  text: string
  branch?: string
}

/**
 * What a row with `each` printed: each run it names with its words, a run named twice once with
 * its words joined, and each new run it asks for, what it is for named twice once, the same way.
 * Nothing for output that says no work ({@link isDue}); a reason for output that is no such list.
 */
export function eachItems(stdout: string): { resumes: ResumeItem[]; starts: StartItem[] } | string {
  if (!isDue(stdout)) return { resumes: [], starts: [] }
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return 'the check printed no JSON'
  }
  if (!Array.isArray(value)) return 'the check printed no list'
  const runs = new Map<string, string[]>()
  const starts = new Map<string, { texts: string[]; branch?: string }>()
  for (const item of value) {
    const said = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    const field = (key: string): string | undefined => (typeof said[key] === 'string' && said[key].trim() ? said[key].trim() : undefined)
    const [text, run, what, branch] = [field('text'), field('run'), field('for'), field('branch')]
    const named = said['branch'] !== undefined
    if (text === undefined || (run === undefined) === (what === undefined) || (named && (branch === undefined || run !== undefined))) return 'an item of the list is no { "run": "<id>", "text": "…" } and no { "for": "<what>", "text": "…" }, with "branch" only beside "for"'
    if (run !== undefined) runs.set(run, [...(runs.get(run) ?? []), text])
    else {
      // What a run is for named twice: its words joined, on the first branch named.
      const before = starts.get(what!)
      const on = before?.branch ?? branch
      starts.set(what!, { texts: [...(before?.texts ?? []), text], ...(on !== undefined ? { branch: on } : {}) })
    }
  }
  return {
    resumes: [...runs].map(([run, texts]) => ({ run, text: texts.join('\n\n') })),
    starts: [...starts].map(([what, { texts, branch }]) => ({ for: what, text: texts.join('\n\n'), ...(branch !== undefined ? { branch } : {}) })),
  }
}

/**
 * What a run is handed with its prompt when a check started it: {@link FOUND_OPENING}, then what
 * the check printed, so an agent whose command asks for the new thing has it. The command's prompt
 * stays the command alone: it is what the run is counted under.
 *
 * A NUL character is dropped: the text travels as a command-line argument, which can hold none.
 * Output past {@link FOUND_MAX} characters is cut at the end of the last whole line that fits,
 * mid-line when its first line alone is longer. A last line then says how much was printed and
 * the time the check was given: the next check asks from this run's start, so what was cut is
 * found again only by an agent that asks from that earlier time itself.
 */
export function checkFound(stdout: string, lastRun: string): string {
  return `${FOUND_OPENING}\n${foundOutput(stdout, lastRun)}`
}

/** What a check printed, as a run is handed it and as a person trying the check is shown it: without NUL characters and outer blank lines, cut when it is long, the cut said in a last line. */
function foundOutput(stdout: string, lastRun: string): string {
  const printed = stdout.replaceAll('\0', '').trim()
  if (printed.length <= FOUND_MAX) return printed
  const fits = printed.slice(0, FOUND_MAX)
  // A line that ends exactly at the limit is whole: the line end is the next character.
  const lineEnd = printed[FOUND_MAX] === '\n' ? FOUND_MAX : fits.lastIndexOf('\n')
  const shown = lineEnd > 0 ? fits.slice(0, lineEnd) : fits
  return `${shown}\n(cut: the check printed ${printed.length} characters, these are the first ${shown.length}; it asked what is new since ${lastRun})`
}

/**
 * What is said before a check's output. The agent has never seen the check, and a check may print
 * only a sign that there is work (one issue of five that changed): so the words say what the
 * output is, and that the command, not the output, says what the work is.
 */
export const FOUND_OPENING = 'The scheduler starts this command when its check prints something, and this time the check printed what is below. It says why this run started; what the work is, the command says.'

/**
 * What a run of an automation kept on this machine is handed with its prompt: the automation's
 * text, and after it, when a check started the run, the sentence that says so and what the check
 * printed.
 */
export function ownAttached(text: string, found?: { stdout: string; lastRun: string }): string {
  return found ? `${text}\n\n${FOUND_OPENING_OWN}\n${foundOutput(found.stdout, found.lastRun)}` : text
}

/** What is said before a check's output to a run of an automation kept on this machine: its work is said by the text above, not by a command. */
export const FOUND_OPENING_OWN = 'The scheduler starts this when its check prints something, and this time the check printed what is below. It says why this run started; what the work is, the text above says.'

/**
 * What a run a row resumes is told: the command, as a run it starts is sent, then
 * {@link RESUMED_OPENING} and the check's words for that run; for an automation kept on this
 * machine, its name, its text, then the opening and the words. One text: a resume takes no
 * attached text.
 */
export function resumeText(command: Pick<ScheduledCommand, 'name' | 'text'>, words: string, lastRun: string): string {
  const found = foundOutput(words, lastRun)
  const said = command.text !== undefined ? `${command.text}\n\n${RESUMED_OPENING_OWN}\n${found}` : `${RESUMED_OPENING}\n${found}`
  return `${commandPrompt(command)}\n\n${said}`
}

/** What is said before the check's words to a run a row resumes: the run has never seen the check, and the command, not the words, says what the work is. */
export const RESUMED_OPENING = 'The scheduler continues this run with this command when its check names the run, and this time the check said what is below for it. It says why the run continues; what the work is, the command says.'

/** The same for a run an automation kept on this machine resumes: its work is said by the text above. */
export const RESUMED_OPENING_OWN = 'The scheduler continues this run with this when its check names the run, and this time the check said what is below for it. It says why the run continues; what the work is, the text above says.'

/** How much of a failed check's last line of error is answered, in characters. */
const ERROR_MAX = 500

/** What trying a check answered. */
export interface Tried {
  /** The time the check was given as `$LAST_RUN`. */
  lastRun: string
  /** Whether the check ran to its end without an error. */
  ran: boolean
  /** Whether what it printed would start an agent. */
  due: boolean
  /** What it printed, cut as a run is handed it, with the line that says it was cut. */
  printed: string
  /** Why it did not run, when it did not: that it took too long, or the last line of what it said went wrong. */
  error?: string
}

/**
 * Run a check once, as the tick would, and say what it printed and whether an agent would start:
 * nothing is saved and nothing is started. It asks what is new since a day ago. A try has less
 * time than a tick gives a check ({@link TRY_TIMEOUT_MS}): whoever asks, a dashboard, waits for
 * the answer, and gives up before a tick would.
 */
export async function tryCheck(repo: string, shell: string, now: Date, check: typeof runCheck = runCheck, budgetMs: number = TRY_TIMEOUT_MS): Promise<Tried> {
  const lastRun = lastRunValue(neverStartedSince(now))
  const started = Date.now()
  const checked = await check(repo, shell, budgetMs, lastRun)
  const printed = foundOutput(checked.stdout, lastRun)
  if (checked.ok) return { lastRun, ran: true, due: isDue(checked.stdout), printed }
  const said = checked.stderr.trim().split('\n').at(-1) ?? ''
  const error = Date.now() - started >= budgetMs ? `it took longer than ${budgetMs / 1000} seconds` : said.length > ERROR_MAX ? `${said.slice(0, ERROR_MAX)}…` : said
  return { lastRun, ran: false, due: false, printed, error }
}
