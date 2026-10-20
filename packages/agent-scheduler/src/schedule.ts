import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { HARNESS_SKILL_DIRS } from '@openagt/skill-branches'
import { automationOf, isPlainFile, standsAlone } from './automation-file.js'
import { AGENTS, AGENT_SKILLS_DIR, DEFAULT_AGENT, DEFAULT_CAP, FOUND_MAX, MAX_AGENTS, OWN_AUTOMATIONS_DIR, OWN_TEXT_MAX, RUN_SKILLS_DIR, SKILL_FILE, isAgent, isAgents, type AgentName } from './names.js'
import { parseInterval, type Interval } from './pace.js'

/**
 * The schedule (#2022): the scheduled commands of a project, each brought by the skill it runs.
 * The tool knows no command by name; a skill says it can be scheduled with a `schedule` in the
 * front matter of its `SKILL.md`, and a skill that is not in the project has no command here.
 *
 *     ---
 *     name: update-tickets
 *     disable-model-invocation: true
 *     schedule:
 *       every: 15m
 *       when: npx @openagt/skill-tickets@0.1 meta | jq …
 *       waits-for: when an issue changed since the last import
 *     ---
 *
 * A skill with several modes lists one row per mode, each with the `word` the skill gets as its
 * argument (`triage quick`, `triage consensual`):
 *
 *     schedule:
 *       - word: quick
 *         every: 6h
 *       - word: consensual
 *         every: 7d
 *
 * A command is named as a person types it, without the slash: the skill's folder name, then the
 * row's word when it has one. The whole name is the command's identity (its prompt, its switch,
 * its interval, its cap, its run records).
 *
 * `when` is a shell command, run at the repository root. The command is due while the check
 * exits 0 and prints something other than an empty JSON value. The check may read `$LAST_RUN`,
 * the time its command last started on any machine, or was switched on on this one when that is
 * later: a check that asks what is new since then goes quiet once a run was started for it.
 * Inside a single-quoted `jq` program the shell does not fill it in: `env.LAST_RUN` reads it there. `every` is how often at most: the
 * command is due only once that long has passed since its last recorded start. A row carries one
 * or both; with both, the command starts only when both hold. `waits-for` is one plain line
 * saying what the check waits for, for a person: a check is a shell line nothing can turn into a
 * sentence. `agents` is how many runs of the command may be in flight at once, across every
 * machine that shares the repository, from 1 to 99. `check-every: <N>s`, from 10 to 59 seconds,
 * lets the check run that often between the minute's ticks, for a row whose answer is waited for:
 * its check must be cheap to run so often.
 *
 * A row with `resumes: true` starts no run: it continues runs that ended. Its check prints which,
 * each with its words: `[{ "run": "<id>", "text": "…" }]`, and each run named is resumed with the
 * command and its words, on the coding agent, model and publish level its own record names; so
 * such a row names no `agent` and no `model`. Only a run this machine started is resumed: only
 * this machine holds its conversation. What the words are about is the check's and the skill's:
 * the scheduler knows nothing of it.
 *
 * Whether a command runs, and how far its runs publish, is not the skill's to say: each person
 * sets both on their own machine, in the tool's state. The pace and the number of agents are
 * where the skill starts: each person may set their own there too.
 *
 * A `schedule` the reader cannot read is skipped and named, so a typo stands down one skill's
 * commands and says so rather than silently doing nothing.
 *
 * The schedule is read from every folder a coding agent reads skills from, so a project's skills
 * are all listed; a command whose skill is not in the folder of the agent that runs scheduled
 * commands is listed and never started, and the tick says so.
 */

/** One command as its skill schedules it. */
export interface ScheduledCommand {
  /** The command as typed without its slash: the skill's folder name, then at most one word the skill gets as its argument (`triage quick`). */
  name: string
  /** The check, a shell command line; absent when the row paces by time alone. */
  when?: string
  /** How often at most, where no person set another pace: the least time since the command's last recorded start. */
  every?: Interval
  /** What the check waits for, in one plain line for a person. */
  waitsFor?: string
  /** How often the check may run between the minute's ticks, when the row says: its check is cheap and its answer waited for. */
  checkEvery?: { ms: number; text: string }
  /** Runs in flight at once, across every machine, where no person set another number. */
  cap: number
  /** The skills folder the skill was read from (`.claude/skills`). */
  dir: string
  /** Every skills folder that holds the skill: a coding agent can run the command only when its own folder is among them. */
  dirs: string[]
  /** The coding agent the skill is made for, when it names one: a run is on it where no person picked another. */
  agent?: AgentName
  /** The model the skill is made for, when it names one: a model of the agent the skill names, of Claude Code when it names none. A run on that agent starts on it where no person picked another; a run on another agent does not. */
  model?: string
  /** What the skill does, in its own words: the `description` of its front matter, when it has one. */
  description?: string
  /** Whether the row resumes the runs its check names, and starts none: each goes on with its own coding agent, model and publish level. */
  resumes?: true
  /**
   * The text of a command that is no skill: an automation a person keeps on this machine alone.
   * Its text is in no checkout, so a run of it is handed the text with its prompt, which is the
   * automation's name. A skill's command has none: its run is sent the command
   * (`/update-tickets`), and the coding agent reads the skill's text from the checkout.
   */
  text?: string
  /**
   * Whether the command is a person's own automation whose file reads as the tool writes one, and
   * is no link: the tool can show it, save it again and remove it. Neither a skill a person or a
   * package wrote, nor an automation changed by hand into something the tool does not write. The
   * one place that says so: the command line asks the schedule.
   */
  editable?: true
}

/** The schedule as read. */
export interface Schedule {
  commands: ScheduledCommand[]
  /** The skills whose `schedule` could not be read, each with why; and, marked `own`, the automations kept on this machine that are not listed. */
  unreadable: { skill: string; reason: string; own?: true }[]
  /** The names a skill of the project and an automation kept on this machine both have: neither is listed, and this machine's picks under such a name are taken back. */
  clashes?: string[]
}

const SKILL = /^[a-z0-9][a-z0-9-]*$/
const WORD = SKILL
const ROW_KEYS = ['word', 'every', 'when', 'waits-for', 'check-every', 'agents', 'agent', 'model', 'resumes']

/** `check-every`: a whole number of seconds from 10 to 59, and `s`. */
const CHECK_EVERY = /^([1-5][0-9])s$/

/**
 * The commands a skill schedules, out of its `SKILL.md` in the skills folder `dir`: none when the
 * file has no front matter or the front matter no `schedule`. One row or a list of rows; any row
 * that cannot be read makes the whole `schedule` unreadable, and the reason names the row. Pure.
 */
export function skillSchedule(skill: string, md: string, dir: string): Schedule {
  const unreadable = (reason: string): Schedule => ({ commands: [], unreadable: [{ skill, reason }] })
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)
  if (!front) return { commands: [], unreadable: [] }
  let data: unknown
  try {
    data = parseYaml(front[1]!)
  } catch {
    // Only a skill that tries to schedule something is named: a coding agent reads front matter
    // more loosely than YAML does, and a skill with no `schedule` is none of this tool's business.
    return /^schedule\s*:/m.test(front[1]!) ? unreadable('the front matter is not YAML') : { commands: [], unreadable: [] }
  }
  const written = isMap(data) ? data['schedule'] : undefined
  if (written === undefined) return { commands: [], unreadable: [] }
  // A `schedule:` with nothing after it is YAML's null: no row, like an empty list.
  const rows = Array.isArray(written) ? written : written === null ? [] : [written]
  if (rows.length === 0) return unreadable('the schedule lists no row')
  const said = isMap(data) ? data['description'] : undefined
  const description = typeof said === 'string' && said.trim() ? { description: said.trim() } : {}
  const commands: ScheduledCommand[] = []
  for (const row of rows) {
    const command = parseRow(skill, row, dir)
    if (typeof command === 'string') return unreadable(rows.length > 1 ? `row ${commands.length + 1}: ${command}` : command)
    if (commands.some(c => c.name === command.name)) return unreadable(`two rows are named ${command.name}`)
    commands.push({ ...command, ...description })
  }
  return { commands, unreadable: [] }
}

/**
 * One row: `every: <N><m|h|d|w|mo>`, `when: <shell line>`, `waits-for: <one line>`, `check-every: <N>s`, `agents: <N>`,
 * `word: <the skill's argument>`, `resumes: true`. At least one of `every` and `when`, else nothing says when.
 * `every: 0m` is refused rather than read as "always", which is the key being absent. A key the
 * reader does not know is refused too: it is a typo, or a rule this tool would not follow.
 * `waits-for` says what the check waits for, so a row without `when` has none. A row that resumes
 * needs `when`, which names the runs, and takes no `agent` and no `model`: each run names its own.
 * Answers the command, or why the row cannot be read.
 */
function parseRow(skill: string, row: unknown, dir: string): ScheduledCommand | string {
  if (!isMap(row)) return 'a row is a list of keys'
  const unknown = Object.keys(row).find(key => !ROW_KEYS.includes(key))
  if (unknown !== undefined) return `unknown key ${unknown}`
  const { word, every, when, agents, agent, model, resumes } = row
  const waitsFor = row['waits-for']
  const checkEvery = row['check-every']
  if (word !== undefined && !(typeof word === 'string' && WORD.test(word))) return 'word is one word of lower-case letters, digits and dashes'
  const asEvery = every === undefined ? undefined : parseInterval(String(every))
  if (every !== undefined && !asEvery) return 'every is a number from 1 to 9999 and a unit, m, h, d, w or mo (15m, 6h, 7d, 2w, 1mo)'
  if (when !== undefined && !(typeof when === 'string' && when.trim())) return 'when is a shell command line'
  if (waitsFor !== undefined && !(typeof waitsFor === 'string' && waitsFor.trim() && !waitsFor.trim().includes('\n'))) return 'waits-for is one line of text'
  if (agents !== undefined && !isAgents(agents)) return `agents is a whole number from 1 to ${MAX_AGENTS}`
  if (agent !== undefined && !isAgent(agent)) return `agent is one of ${AGENTS.join(', ')}`
  if (model !== undefined && !(typeof model === 'string' && /^\S+$/.test(model))) return 'model is one word, the id its coding agent knows the model by'
  if (when === undefined && every === undefined) return 'neither every nor when says when'
  if (waitsFor !== undefined && when === undefined) return 'waits-for says what when waits for, and there is no when'
  if (checkEvery !== undefined && !CHECK_EVERY.test(String(checkEvery))) return 'check-every is a number of seconds from 10 to 59 and s (15s)'
  if (checkEvery !== undefined && when === undefined) return 'check-every says how often when runs, and there is no when'
  if (resumes !== undefined && resumes !== true) return 'resumes is true, or left out'
  if (resumes === true && when === undefined) return 'a row that resumes needs when, the check that names the runs to resume'
  if (resumes === true && (agent !== undefined || model !== undefined)) return `a row that resumes takes no ${agent !== undefined ? 'agent' : 'model'}: each run goes on with the coding agent and model its record names`
  return {
    name: word === undefined ? skill : `${skill} ${word}`,
    ...(typeof when === 'string' ? { when: when.trim() } : {}),
    ...(asEvery ? { every: asEvery } : {}),
    ...(typeof waitsFor === 'string' ? { waitsFor: waitsFor.trim() } : {}),
    ...(checkEvery !== undefined ? { checkEvery: { ms: Number(CHECK_EVERY.exec(String(checkEvery))![1]) * 1000, text: String(checkEvery) } } : {}),
    cap: isAgents(agents) ? agents : DEFAULT_CAP,
    dir,
    dirs: [dir],
    ...(isAgent(agent) ? { agent } : {}),
    ...(typeof model === 'string' ? { model } : {}),
    ...(resumes === true ? { resumes: true as const } : {}),
  }
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The project's schedule: every skill's commands, the skills in name order, then the automations
 * a person keeps on this machine alone, in name order. Skills are read from each folder a coding
 * agent reads skills from, the folder of the agent that runs scheduled commands first; a skill in
 * two folders is read once, from the first folder that holds its `SKILL.md`. A project with no
 * skills folder and no automation of the person's schedules nothing.
 *
 * An automation kept on this machine is one file, written like a skill's: its front matter holds
 * one row of schedule, and its text is what a run is handed. One that cannot be listed is named
 * with why. One whose name a skill of the project has too is not listed, and neither are that
 * skill's commands: a run is counted by its command's name and this machine's picks are kept
 * under it, so the two cannot be told apart.
 */
export async function readSchedule(repo: string): Promise<Schedule> {
  const files = new Map<string, { md: string; dir: string; dirs: string[] }>()
  for (const dir of [RUN_SKILLS_DIR, ...HARNESS_SKILL_DIRS.filter(d => d !== RUN_SKILLS_DIR)]) {
    const entries = await readdir(join(repo, dir)).catch(() => [])
    for (const skill of entries) {
      if (!SKILL.test(skill)) continue
      const known = files.get(skill)
      // A skill in two folders is read once, from the first; the other folder is only noted, by whether the skill's file is there.
      const md = known ? ((await isFile(join(repo, dir, skill, SKILL_FILE))) ? known.md : undefined) : await readFile(join(repo, dir, skill, SKILL_FILE), 'utf8').catch(() => undefined)
      if (md === undefined) continue
      if (known) known.dirs.push(dir)
      else files.set(skill, { md, dir, dirs: [dir] })
    }
  }
  const schedule: Schedule = { commands: [], unreadable: [] }
  for (const skill of [...files.keys()].sort()) {
    const { md, dir, dirs } = files.get(skill)!
    const read = skillSchedule(skill, md, dir)
    // A shared automation is a skill the tool wrote: its file reads as the tool writes one, alone in its folder where the tool saves them, a folder that is no link.
    const editable = automationOf(skill, md) !== undefined && (await standsAlone(repo, skill))
    schedule.commands.push(...read.commands.map(command => ({ ...command, dirs, ...(editable ? { editable: true as const } : {}) })))
    schedule.unreadable.push(...read.unreadable)
  }
  const kept = (await readdir(join(repo, OWN_AUTOMATIONS_DIR)).catch((): string[] => [])).filter(file => file.endsWith('.md')).sort()
  for (const file of kept) {
    const name = file.slice(0, -3)
    const unlisted = (reason: string): void => void schedule.unreadable.push({ skill: name, reason, own: true })
    if (!SKILL.test(name)) {
      unlisted('its file is named with something other than lower-case letters, digits and dashes')
      continue
    }
    const md = await readFile(join(repo, OWN_AUTOMATIONS_DIR, file), 'utf8').catch(() => undefined)
    if (md === undefined) {
      unlisted('its file cannot be read')
      continue
    }
    if (files.has(name)) {
      // One name, two things: a run is counted by its command's name, and this machine's picks are
      // kept under it. Neither is listed, and the picks are taken back, so that the skill's command
      // does not start on the switch the automation was given, now or once the file is gone.
      const before = schedule.commands.length
      schedule.commands = schedule.commands.filter(c => c.name.split(' ')[0] !== name)
      schedule.clashes = [...(schedule.clashes ?? []), name]
      unlisted(`a skill of the project has this name too${schedule.commands.length < before ? ', so neither is listed' : ''}: rename or remove ${OWN_AUTOMATIONS_DIR}/${file}, then switch on what you want`)
      continue
    }
    const read = skillSchedule(name, md, OWN_AUTOMATIONS_DIR)
    const text = skillText(md)
    if (read.unreadable.length > 0) unlisted(read.unreadable[0]!.reason)
    else if (read.commands.length === 0) unlisted('it has no schedule')
    else if (read.commands.length !== 1 || read.commands[0]!.name !== name) unlisted('it has one row, with no word')
    else if (text === '') unlisted('it has no text after its front matter')
    else if (text.length > OWN_TEXT_MAX) unlisted(`its text is ${text.length} characters, and ${OWN_TEXT_MAX} is the most`)
    else schedule.commands.push({ ...read.commands[0]!, text, ...(automationOf(name, md) !== undefined && (await isPlainFile(join(repo, OWN_AUTOMATIONS_DIR, file))) ? { editable: true as const } : {}) })
  }
  return schedule
}

/** Whether a path is a file, a link to one included: a skill linked into an agent's folder is a skill there. */
function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    found => found.isFile(),
    () => false,
  )
}

/**
 * The text of a skill file after its front matter, without its outer blank lines and without NUL
 * characters: what an agent is told. The front matter ends where the schedule's reader ends it,
 * at the first line that opens with three dashes, whatever follows them on that line.
 */
export function skillText(md: string): string {
  const front = /^---\r?\n[\s\S]*?\r?\n---[^\n]*(\n|$)/.exec(md)
  return (front ? md.slice(front[0].length) : md).replaceAll('\0', '').trim()
}

/** The file a command's skill is, from the repository root: the skills folder it was read from, or the one given, the command's first word, the skill's file (`.claude/skills/triage/SKILL.md` for `triage quick`). */
export function skillFile(command: Pick<ScheduledCommand, 'name' | 'dir'>, dir: string = command.dir): string {
  return `${dir}/${command.name.split(' ')[0]}/${SKILL_FILE}`
}

/**
 * The coding agents that can run a command: those whose own skills folder holds its skill. An
 * automation kept on this machine is no skill: a run is handed its text, so any agent can.
 */
export function ableAgents(command: Pick<ScheduledCommand, 'dirs' | 'text'>): AgentName[] {
  return AGENTS.filter(agent => command.text !== undefined || command.dirs.includes(AGENT_SKILLS_DIR[agent]))
}

/**
 * The coding agent a command is made for: the one its skill names, else Claude Code when it can
 * run the command, else the one that can. Where a run is on when no person picked another, and
 * the agent the skill's own model goes with.
 */
export function homeAgent(command: Pick<ScheduledCommand, 'agent' | 'dirs' | 'text'>): AgentName {
  if (command.agent !== undefined) return command.agent
  const able = ableAgents(command)
  return able.includes(DEFAULT_AGENT) ? DEFAULT_AGENT : (able[0] ?? DEFAULT_AGENT)
}

/**
 * The prompt a command runs with: its slash command, which the agent's harness expands, the word
 * after it handed to the skill. An automation kept on this machine is no command in a run's
 * checkout: its prompt is its name alone, with no slash, and its text is handed over with it
 * ({@link ownAttached}). Either way the prompt names the command, which is what its runs are
 * counted by, whatever its text says and however the text changes.
 */
export function commandPrompt(command: Pick<ScheduledCommand, 'name' | 'text'>): string {
  return command.text === undefined ? `/${command.name}` : command.name
}

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
 * The time a check is given as `$LAST_RUN`: an ISO time in UTC to the whole second
 * (`2026-10-09T10:00:00Z`), the shape `gh --search`, a GitHub `since` and `jq`'s `fromdate` all
 * read. The fraction of a second is dropped, never rounded up: a thing that came in that same
 * second is found twice rather than never.
 */
export function lastRunValue(iso: string): string {
  return new Date(Math.floor(Date.parse(iso) / 1000) * 1000).toISOString().replace('.000Z', 'Z')
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
export function foundOutput(stdout: string, lastRun: string): string {
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
 * What a row that resumes printed: each run it names with its words, a run named twice once with
 * its words joined. Nothing for output that says no work ({@link isDue}); a reason for output that
 * is not `[{ "run": "<id>", "text": "…" }]`.
 */
export function runsToResume(stdout: string): { run: string; text: string }[] | string {
  if (!isDue(stdout)) return []
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return 'the check printed no JSON'
  }
  if (!Array.isArray(value)) return 'the check printed no list'
  const runs = new Map<string, string[]>()
  for (const item of value) {
    if (!isMap(item) || typeof item['run'] !== 'string' || !item['run'].trim() || typeof item['text'] !== 'string' || !item['text'].trim()) return 'an item of the list is no { "run": "<id>", "text": "…" }'
    const id = item['run'].trim()
    runs.set(id, [...(runs.get(id) ?? []), item['text'].trim()])
  }
  return [...runs].map(([run, texts]) => ({ run, text: texts.join('\n\n') }))
}

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

/**
 * The command a run's prompt is counted under, so a run a person started counts against that
 * command's cap and interval like a scheduled one; nothing for a prompt that names none.
 *
 * A prompt that opens with a slash names a skill's command: the scheduled command whose name it
 * is (`/triage quick` → `triage quick`), else the one its first word is (`/work-queue now` →
 * `work-queue`). A prompt with no slash names no skill's command: it is a run of an automation
 * kept on this machine when it is that automation's name and nothing else (`answer-comments`).
 * The two never cross: a skill's command typed by hand is no run of an automation of that name,
 * and an automation's run is none of a skill's.
 */
export function promptCommand(prompt: string, schedule: Schedule): string | undefined {
  const typed = prompt.trim()
  if (!typed.startsWith('/')) return schedule.commands.some(c => c.text !== undefined && c.name === typed) ? typed : undefined
  const skills = schedule.commands.filter(c => c.text === undefined)
  const named = typed.slice(1)
  if (skills.some(c => c.name === named)) return named
  const first = named.split(/\s+/)[0]!
  return skills.some(c => c.name === first) ? first : undefined
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
