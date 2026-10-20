import { mkdir, readdir, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { excludeFromGit, originDefaultBranch, type GitRunner } from '@openagt/agent-data'
import { HARNESS_SKILL_DIRS } from '@openagt/skill-branches'
import { MAX_NAME, NEVER_STARTED_SINCE_MS, OWN_AUTOMATIONS_DIR, OWN_TEXT_MAX, RUN_SKILLS_DIR, SKILL_FILE, STATE_DIR, TRY_TIMEOUT_MS, isCommandName } from './names.js'
import { createHash } from 'node:crypto'
import { FOLDER_LITTER, HALF_SAVED, automationOf, automationSkill, frontMatterOf, wellFormed, type NewAutomation } from './automation-file.js'
import { foundOutput, isDue, lastRunValue, readSchedule, skillFile, skillSchedule } from './schedule.js'
import { runCheck } from './tick.js'

/**
 * A person's own automation: a prompt they wrote, saved as a command skill of the project, so it
 * has a row like any skill's and the tick treats it as one. The skill's text is the
 * prompt; its front matter makes it a command (`disable-model-invocation`) and carries the
 * `schedule` the person picked: a pace, a check, or both.
 *
 * Shared with the project, it is a file in the person's checkout, in the folder the coding agent
 * that runs scheduled commands reads. Like any skill a person writes there, it is no command to a
 * run until it is on the commit a run's checkout starts from: the person commits it and brings it
 * there. Kept on this machine alone, it is the same file in the tool's own folder, and a run is
 * handed its text with a prompt that is the automation's name.
 *
 * Saved, it can be shown, saved again with other words under the same name, and removed: only
 * while its file still reads as the tool writes one (`automation-file.ts`).
 */

export type AddRefusal =
  | { ok: false; reason: 'bad-name'; detail: string }
  | { ok: false; reason: 'no-prompt' }
  | { ok: false; reason: 'long-prompt'; detail: string }
  | { ok: false; reason: 'bad-schedule'; detail: string }
  | { ok: false; reason: 'taken'; folder: string }

/**
 * Why an automation cannot be saved as written, or nothing: its name, its prompt, and its
 * schedule by the very reader the tick reads skills with. What the reader reads back has to be
 * what was typed, and the file has to read the same to a coding agent, whose reader ends the
 * front matter at the first three dashes it meets anywhere.
 */
export function automationProblem(automation: NewAutomation): AddRefusal | undefined {
  if (!isCommandName(automation.name)) return { ok: false, reason: 'bad-name', detail: 'a name is lower-case letters, digits and single or double dashes, and starts with a letter or a digit' }
  if (automation.name.length > MAX_NAME) return { ok: false, reason: 'bad-name', detail: `a name is ${MAX_NAME} characters at most` }
  // A NUL character is no text: a file holds none of it for an agent.
  if (!automation.prompt.replaceAll('\0', '').trim()) return { ok: false, reason: 'no-prompt' }
  const text = automationSkill(automation)
  const read = skillSchedule(automation.name, text, RUN_SKILLS_DIR)
  const unreadable = read.unreadable[0]
  if (unreadable) return { ok: false, reason: 'bad-schedule', detail: unreadable.reason }
  const command = read.commands[0]
  const when = automation.when === undefined ? undefined : wellFormed(automation.when.trim())
  const waitsFor = automation.waitsFor === undefined ? undefined : wellFormed(automation.waitsFor.trim())
  if (!command || command.when !== when || command.waitsFor !== waitsFor || frontMatterOf(text).includes('---')) return { ok: false, reason: 'bad-schedule', detail: 'it would not read back as typed' }
  return undefined
}

/** Where an automation's file was written, new or anew, and what whoever asked needs to say about it. */
export interface Written {
  ok: true
  command: string
  /** The file written, from the repository root. */
  file: string
  /** What a run's checkout starts from, as git names it: where a shared automation's file has to get to before its command can start. */
  startsFrom: string
  /** Whether it is kept on this machine alone: it needs no commit, and its command can start at once. */
  onThisMachine?: true
  /** What the file says now, as {@link SavedAutomation.version} names it, when it was written anew: what the next save from the same place is held against. */
  version?: string
}

/** A name for what a file says: the same text has the same name, and any change another. */
function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * Save an automation, shared with the project or kept on this machine alone.
 *
 * Shared, it is a skill file of the project, which the person commits; like any skill, its command
 * starts no run before the file is on the commit a run's checkout starts from. Kept on this
 * machine, it is one file in the tool's own folder, hidden from git like the state: nobody else
 * gets the row, nothing is to commit, and a run of it is handed its text.
 *
 * Refused when it cannot be read back as written, and when its name is taken, whatever its
 * capitals: by a skill in any folder a coding agent reads skills from, or by an automation kept on
 * this machine. An automation never replaces either, and on a disk that ignores capitals `Foo` and
 * `foo` are one name. A write that fails leaves no empty folder behind, shared or kept here.
 */
export async function addAutomation(repo: string, automation: NewAutomation, git: GitRunner, opts: { onThisMachine?: boolean; write?: typeof writeFile } = {}): Promise<Written | AddRefusal> {
  const write = opts.write ?? writeFile
  const problem = automationProblem(automation)
  if (problem) return problem
  for (const dir of HARNESS_SKILL_DIRS) {
    const there = (await readdir(join(repo, dir)).catch((): string[] => [])).find(name => name.toLowerCase() === automation.name)
    if (there !== undefined) return { ok: false, reason: 'taken', folder: `${dir}/${there}` }
  }
  const kept = (await readdir(join(repo, OWN_AUTOMATIONS_DIR)).catch((): string[] => [])).find(file => file.toLowerCase() === `${automation.name}.md`)
  if (kept !== undefined) return { ok: false, reason: 'taken', folder: `${OWN_AUTOMATIONS_DIR}/${kept}` }
  const origin = await originDefaultBranch(repo, git).catch(() => undefined)
  const startsFrom = origin ?? 'HEAD'
  if (opts.onThisMachine) {
    // Its text travels to each run as one command-line argument: a longer one could be saved and never listed.
    const length = automation.prompt.trim().length
    if (length > OWN_TEXT_MAX) return { ok: false, reason: 'long-prompt', detail: `the prompt is ${length} characters, and one kept on this machine has ${OWN_TEXT_MAX} at most` }
    const file = `${OWN_AUTOMATIONS_DIR}/${automation.name}.md`
    await mkdir(join(repo, OWN_AUTOMATIONS_DIR), { recursive: true })
    // The tool's folder is hidden from git before anything of a person's is in it; best-effort, as for the state.
    await excludeFromGit(repo, `/${STATE_DIR}`, undefined, git).catch(() => {})
    try {
      await write(join(repo, file), automationSkill(automation), { flag: 'wx' })
    } catch (err) {
      // Another save made it since the look above.
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { ok: false, reason: 'taken', folder: file }
      // The folder made for the first automation is not left empty behind a write that failed.
      await rmdir(join(repo, OWN_AUTOMATIONS_DIR)).catch(() => {})
      throw err
    }
    return { ok: true, command: automation.name, file, startsFrom, onThisMachine: true }
  }
  const folder = join(repo, RUN_SKILLS_DIR, automation.name)
  await mkdir(join(repo, RUN_SKILLS_DIR), { recursive: true })
  try {
    // Never into a folder that is there: another save may have made it since the look above.
    await mkdir(folder)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { ok: false, reason: 'taken', folder: `${RUN_SKILLS_DIR}/${automation.name}` }
    throw err
  }
  try {
    await write(join(folder, SKILL_FILE), automationSkill(automation), { flag: 'wx' })
  } catch (err) {
    await rmdir(folder).catch(() => {})
    throw err
  }
  return { ok: true, command: automation.name, file: `${RUN_SKILLS_DIR}/${automation.name}/${SKILL_FILE}`, startsFrom }
}

/** An automation where it is saved: what `show` answers, and what `edit` and `remove` act on. */
export interface SavedAutomation {
  automation: NewAutomation
  /** Its file, from the repository root. */
  file: string
  /** Whether it is kept on this machine alone. */
  onThisMachine?: true
  /** A name for what its file says now: a save may be held against it, so it does not write over a change made since. */
  version: string
}

/** Why a name is no automation the tool rewrites or removes. */
export type NotAnAutomation = { ok: false; reason: 'not-an-automation'; detail: string }

/** Why an automation was not saved again: its file says something else than whoever asked last read. */
export type ChangedSince = { ok: false; reason: 'changed-since'; detail: string }

/**
 * The automation of that name, where it is saved, or why the tool leaves what has the name alone.
 *
 * The tool rewrites and removes only what it wrote, and the schedule says what that is
 * (`editable`): a command whose file reads as the tool writes one, in the tool's own folder, or
 * alone in a skill folder of the project that is no link. A skill a person or a package wrote, and
 * an automation changed by hand into something the tool does not write, are edited and removed by
 * hand: rewriting one from here would lose what the tool does not write. What the schedule does
 * not list is left alone too, with the schedule's own reason when it has one.
 */
export async function savedAutomation(repo: string, name: string): Promise<SavedAutomation | NotAnAutomation> {
  const none = (detail: string): NotAnAutomation => ({ ok: false, reason: 'not-an-automation', detail })
  const schedule = await readSchedule(repo)
  const command = schedule.commands.find(c => c.name === name)
  if (!command) {
    const unlisted = schedule.unreadable.find(u => u.skill === name)
    if (!unlisted) return none(`the schedule lists nothing named ${name}`)
    return none(`${unlisted.own ? `the automation ${name}, kept on this machine, is not listed` : `the schedule of ${name} cannot be read`}: ${unlisted.reason}`)
  }
  const kept = command.text !== undefined
  const file = kept ? `${OWN_AUTOMATIONS_DIR}/${name}.md` : skillFile(command)
  // The schedule says the file is the tool's to rewrite; what it holds is read from it now.
  const text = command.editable ? await readFile(join(repo, file), 'utf8').catch(() => '') : ''
  const automation = command.editable ? automationOf(name, text) : undefined
  if (automation) return { automation, file, version: versionOf(text), ...(kept ? { onThisMachine: true as const } : {}) }
  return none(kept ? `${file} is a link, or was changed by hand since it was saved: edit or remove the file itself` : `${dirname(file)} is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself`)
}

/** What `edit` changes of an automation: a part given takes the place of the file's, `null` takes a part out, and a part left out stays as the file says it. */
export interface AutomationChange {
  prompt?: string | undefined
  every?: string | null | undefined
  when?: string | null | undefined
  waitsFor?: string | null | undefined
}

/**
 * Save an automation again under its name, with a new prompt or a new schedule: its file is
 * written anew, where it is, with what was given in place of what it said and the rest as it
 * was. What a check waits for goes out with the check, unless it is given too. Its name stays,
 * and a run is counted by the name, so its past runs, its switch and a person's other picks for
 * it stay its own.
 *
 * A shared one is a file of the project: the change is the person's to commit, and a run reads
 * the prompt from the commit its checkout starts from, so it is told the new words only once the
 * change is there, while the tick reads the new pace and the new check from the person's checkout
 * at once. One kept on this machine has only its file: the next tick reads all of it.
 *
 * Refused for a name that is no automation the tool wrote ({@link savedAutomation}), and for what
 * could not be saved new either ({@link automationProblem}, the length of a text kept here). With
 * `was`, the version whoever asks last read, it is refused too when the file says something else
 * by now: a form opened a while ago does not write over a change made to the file by hand since.
 */
export async function editAutomation(repo: string, name: string, change: AutomationChange, git: GitRunner, opts: { write?: typeof writeFile; was?: string } = {}): Promise<Written | AddRefusal | NotAnAutomation | ChangedSince> {
  const found = await savedAutomation(repo, name)
  if ('reason' in found) return found
  if (opts.was !== undefined && opts.was !== found.version) return { ok: false, reason: 'changed-since', detail: `${found.file} was changed since it was opened here: open it again to see what it says now` }
  const was = found.automation
  const every = change.every === undefined ? was.every : (change.every ?? undefined)
  const when = change.when === undefined ? was.when : (change.when ?? undefined)
  const waitsFor = change.waitsFor === undefined ? (when === undefined ? undefined : was.waitsFor) : (change.waitsFor ?? undefined)
  const automation: NewAutomation = { name, prompt: change.prompt ?? was.prompt, ...(every !== undefined ? { every } : {}), ...(when !== undefined ? { when } : {}), ...(waitsFor !== undefined ? { waitsFor } : {}) }
  const problem = automationProblem(automation)
  if (problem) return problem
  const length = automation.prompt.trim().length
  if (found.onThisMachine && length > OWN_TEXT_MAX) return { ok: false, reason: 'long-prompt', detail: `the prompt is ${length} characters, and one kept on this machine has ${OWN_TEXT_MAX} at most` }
  // Written beside the file and moved over it: a write that fails midway leaves the automation as it was, not a cut file.
  const path = join(repo, found.file)
  const text = automationSkill(automation)
  try {
    await (opts.write ?? writeFile)(`${path}.new`, text)
    await rename(`${path}.new`, path)
  } catch (err) {
    await unlink(`${path}.new`).catch(() => {})
    throw err
  }
  const startsFrom = (await originDefaultBranch(repo, git).catch(() => undefined)) ?? 'HEAD'
  return { ok: true, command: name, file: found.file, startsFrom, version: versionOf(text), ...(found.onThisMachine ? { onThisMachine: true as const } : {}) }
}

/** What removing an automation did, and what whoever asked needs to say about it. */
export type Removed = { ok: true; command: string; /** The file that was deleted, from the repository root. */ file: string } & (
  | {
      /** Kept on this machine alone: it was in no git, and nothing of it is left anywhere. */
      onThisMachine: true
    }
  | {
      /**
       * What git still holds of a shared one's file: `committed`, the file is in a commit, so the
       * deletion is a change of the person's to commit and git can bring the file back; `staged`,
       * it was added to the index and never committed, so a commit made now would still add it;
       * `nothing`, git never knew the file, and it cannot be brought back; `unknown`, git could
       * not be asked.
       */
      git: 'committed' | 'staged' | 'nothing' | 'unknown'
      /** What a run's checkout starts from, as git names it: until the deletion is there, everyone else who has the project keeps the command. */
      startsFrom: string
    }
)

/**
 * Remove an automation: its file is deleted, and the folder that held it alone, with what a file
 * manager left beside it. Nothing is committed, and nothing git holds is changed: the deletion of
 * a shared one is a change of the person's where the file is in a commit, and everyone else keeps
 * the command until the deletion reaches them. What was never committed, a shared one's file or
 * its last changes, and all of one kept on this machine, cannot be brought back. The records of
 * its past runs stay.
 *
 * Refused for a name that is no automation the tool wrote ({@link savedAutomation}).
 */
export async function removeAutomation(repo: string, name: string, git: GitRunner): Promise<Removed | NotAnAutomation> {
  const found = await savedAutomation(repo, name)
  if ('reason' in found) return found
  if (found.onThisMachine) {
    await unlink(join(repo, found.file))
    // The folder made for the first automation goes with the last one.
    await rmdir(join(repo, OWN_AUTOMATIONS_DIR)).catch(() => {})
    return { ok: true, command: name, file: found.file, onThisMachine: true }
  }
  // Git is asked about the file where it really is: the skills folder may be a link to another one.
  const folder = join(await realpath(join(repo, RUN_SKILLS_DIR)), name)
  await unlink(join(folder, SKILL_FILE))
  for (const left of [FOLDER_LITTER, HALF_SAVED]) await unlink(join(folder, left)).catch(() => {})
  await rmdir(folder).catch(() => {})
  // One line for the one file, its first letter what the index holds: `A` for a file added and never committed.
  const held = await git(['status', '--porcelain', '--', join(folder, SKILL_FILE)], repo).catch(() => undefined)
  const startsFrom = (await originDefaultBranch(repo, git).catch(() => undefined)) ?? 'HEAD'
  return { ok: true, command: name, file: found.file, git: held === undefined ? 'unknown' : held.trim() === '' ? 'nothing' : held.startsWith('A') ? 'staged' : 'committed', startsFrom }
}


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
  const lastRun = lastRunValue(new Date(now.getTime() - NEVER_STARTED_SINCE_MS).toISOString())
  const started = Date.now()
  const checked = await check(repo, shell, budgetMs, lastRun)
  const printed = foundOutput(checked.stdout, lastRun)
  if (checked.ok) return { lastRun, ran: true, due: isDue(checked.stdout), printed }
  const said = checked.stderr.trim().split('\n').at(-1) ?? ''
  const error = Date.now() - started >= budgetMs ? `it took longer than ${budgetMs / 1000} seconds` : said.length > ERROR_MAX ? `${said.slice(0, ERROR_MAX)}…` : said
  return { lastRun, ran: false, due: false, printed, error }
}
