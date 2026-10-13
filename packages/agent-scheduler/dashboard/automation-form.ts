import { AGENTS, DEFAULT_AGENT, MAX_NAME, isCommandName } from '../src/names.js'
import { parseInterval } from '../src/pace.js'
import { draftOf, pace, paceArgs, paceProblem, type PaceDraft, type SchedulerCommand } from './schedulers.js'

// A person's own automation as data: what they have typed so far, into the "New automation" form
// or into the Edit panel of a row they made; what still keeps it from being saved; the commands
// that save it (`agent-scheduler add …` for a new one, `edit …` for one opened from its row, and
// `pace …` for a time of day, which is this machine's); the sentence its row would say; what
// trying its shell line answered (`agent-scheduler try …`); and what the page says before and
// after one is removed (`agent-scheduler remove …`).

/** When a person's own automation runs, while they pick: on a pace, with a time of day for days or more, or by its shell line alone. Never "as the skill says": it is no skill's. */
export type OwnPace = Exclude<PaceDraft, { kind: 'skill' }>

/** A person's own automation while they fill it in. The count and the time are text, as typed, so a half-typed one is no pace yet. */
export interface AutomationDraft {
  /** The command's name, without its slash. */
  name: string
  /** What the agent is told. */
  prompt: string
  /** The shell line that says there is work; empty for none. */
  when: string
  /** What the shell line waits for, in plain words; said on the row. */
  waitsFor: string
  /** When it runs: on a pace, or whenever its shell line prints something. */
  pace: OwnPace
  /** Whether it is kept on this machine alone, and not shared with the project as a file to commit. */
  onThisMachine: boolean
}

/**
 * The longest prompt, and the longest shell line, the form can hand over: each travels as one
 * argument of a command the dashboard runs, and the dashboard takes arguments of about four
 * thousand characters. A longer one is written into the saved file by hand.
 */
export const TEXT_MAX = 4000

/** The form as it opens: once a day, no shell line, shared with the project. */
export const EMPTY_DRAFT: AutomationDraft = { name: '', prompt: '', when: '', waitsFor: '', pace: { kind: 'every', count: '1', unit: 'd', at: '' }, onThisMachine: false }

/** The interval a draft's pace is, as a skill writes it (`15m`); nothing without a pace, or while the pace typed is none yet. */
function everyOf(draft: AutomationDraft): string | undefined {
  return draft.pace.kind === 'every' ? paceArgs(draft.pace)?.[0] : undefined
}

/** An automation opened from its row to be saved again: what its file says, as the panel opens, and the file it would write anew. */
export interface OpenedAutomation {
  draft: AutomationDraft
  /** Its file, from the project's root. */
  file: string
  /** The tool's name for what the file said when it was read: saving is held against it, when the answer gives one. */
  version?: string
}

/**
 * Read what `agent-scheduler show` printed into the draft a panel opens with. Nothing when the
 * answer is not what the command promises, a name and a prompt at the least, or holds a pace the
 * panel cannot show: it would then save something other than what is there.
 */
export function openedAutomation(output: unknown): OpenedAutomation | undefined {
  const answer = typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {}
  const { name, prompt, every, when, waitsFor, file } = answer
  if (typeof name !== 'string' || typeof prompt !== 'string' || typeof file !== 'string') return undefined
  const read = every === undefined ? undefined : typeof every === 'string' ? parseInterval(every) : undefined
  if (every !== undefined && !read) return undefined
  return {
    draft: { name, prompt, when: typeof when === 'string' ? when : '', waitsFor: typeof waitsFor === 'string' ? waitsFor : '', pace: read ? { kind: 'every', count: String(read.count), unit: read.unit, at: '' } : { kind: 'work' }, onThisMachine: answer['onThisMachine'] === true },
    file,
    ...(typeof answer['version'] === 'string' ? { version: answer['version'] } : {}),
  }
}

/**
 * The draft a row's panel opens with: what its file says, at the pace its row runs at on this
 * machine. A row has one pace on the page: the time of day a person picked here is shown with the
 * file's interval, and a pick of theirs made before, another interval or "whenever there is
 * work", stands in for the file's until the panel is saved, which writes it into the file.
 */
export function atRowsPace(opened: AutomationDraft, row: SchedulerCommand): AutomationDraft {
  const picked = draftOf(row)
  return picked.kind === 'skill' ? opened : { ...opened, pace: picked }
}

/**
 * What keeps a draft from being saved yet, for the person typing it, the first thing first; nothing
 * when it can be saved. `file` is the file of an automation opened from its row: a text too long
 * for the form is then changed in that file.
 */
export function draftProblem(draft: AutomationDraft, file?: string): string | undefined {
  const name = draft.name.trim()
  if (name === '') return draft.onThisMachine ? 'Give it a name, like answer-comments.' : 'Give it a name. It becomes the command, like /answer-comments.'
  if (!isCommandName(name)) return 'A name is lower-case letters, digits and dashes, never three dashes in a row, like answer-comments.'
  if (name.length > MAX_NAME) return `A name is ${MAX_NAME} characters at most.`
  if (draft.prompt.trim() === '') return 'Write what the agent is told.'
  if (draft.prompt.trim().length > TEXT_MAX) return `What the agent is told is ${draft.prompt.trim().length} characters, and this form takes ${TEXT_MAX} at most. ${file === undefined ? 'Save a shorter one, then write the rest into the file.' : `Change it in its file, ${file}.`}`
  if (draft.when.trim().length > TEXT_MAX) return `The shell line is ${draft.when.trim().length} characters, and this form takes ${TEXT_MAX} at most.`
  if (draft.when.trim() !== '' && draft.waitsFor.trim().length > TEXT_MAX) return `What the line waits for is ${draft.waitsFor.trim().length} characters, and this form takes ${TEXT_MAX} at most.`
  if (draft.pace.kind === 'work' && draft.when.trim() === '') return 'Say when it runs: on a pace, by a shell line, or both.'
  return paceProblem(draft.pace)
}

/**
 * The command that saves a new draft, after `agent-scheduler`; nothing while the draft cannot be
 * saved. Each text goes as one argument with its flag (`--prompt=…`), so one that opens with a
 * dash is still the flag's own text. What the shell line waits for is left out without a line.
 * `--private` keeps it on this machine alone.
 */
export function addArgs(draft: AutomationDraft): string[] | undefined {
  if (draftProblem(draft) !== undefined) return undefined
  return ['add', ...saidOf(draft), ...(draft.onThisMachine ? ['--private'] : [])]
}

/**
 * The command that saves an automation again from the draft it was opened into, after
 * `agent-scheduler`: `edit` with its name and every part the draft has, each in place of what its
 * file said. A part the draft does not have goes as an empty flag (`--when=`), which takes it out
 * of the file: a flag left out would leave that part as it was. Nothing while the draft cannot be
 * saved. Where it is kept is not the command's to change.
 */
export function editArgs(draft: AutomationDraft, file: string): string[] | undefined {
  if (draftProblem(draft, file) !== undefined) return undefined
  const when = draft.when.trim()
  return ['edit', draft.name.trim(), `--prompt=${draft.prompt.trim()}`, `--every=${everyOf(draft) ?? ''}`, `--when=${when}`, `--waits-for=${when !== '' ? draft.waitsFor.trim() : ''}`]
}

/**
 * What a draft's pace leaves for this machine to hold, after `agent-scheduler pace <name>`: its
 * interval with its time of day, when it has one, since a time of day is this machine's and no
 * file says one; else `skill`, the file's own pace and nothing of this machine's. Nothing while
 * the pace typed is none yet.
 */
export function ownPaceArgs(draft: AutomationDraft): string[] | undefined {
  const args = paceArgs(draft.pace)
  if (!args) return undefined
  return draft.pace.kind === 'every' && args[1] !== undefined ? args : ['skill']
}

/** A draft's name and what its file would say, as the arguments of `add`: a part it does not have is left out. */
function saidOf(draft: AutomationDraft): string[] {
  const every = everyOf(draft)
  const when = draft.when.trim()
  const waitsFor = draft.waitsFor.trim()
  return [draft.name.trim(), `--prompt=${draft.prompt.trim()}`, ...(every !== undefined ? [`--every=${every}`] : []), ...(when !== '' ? [`--when=${when}`] : []), ...(when !== '' && waitsFor !== '' ? [`--waits-for=${waitsFor}`] : [])]
}

/** Whether two drafts would write the same file: nothing of the automation itself is to save until they differ. */
export function saysTheSame(a: AutomationDraft, b: AutomationDraft): boolean {
  return saidOf(a).join('\0') === saidOf(b).join('\0')
}

/** A draft as the row it would be: what its file would say, and the time of day this machine would hold for it. Nothing while it has no pace and no shell line that could say when. */
export function draftRow(draft: AutomationDraft): SchedulerCommand | undefined {
  const args = paceArgs(draft.pace)
  const every = everyOf(draft)
  const when = draft.when.trim()
  if (!args || (every === undefined && when === '')) return undefined
  const waitsFor = draft.waitsFor.trim()
  return { command: draft.name.trim(), on: false, publish: 'commit', home: DEFAULT_AGENT, able: AGENTS, ...(every !== undefined ? { every } : {}), ...(when !== '' ? { when, ...(waitsFor !== '' ? { waitsFor } : {}) } : {}), ...(every !== undefined && args[1] !== undefined ? { pace: { every, at: args[1], since: '' } } : {}) }
}

/** When a draft would run, as the sentence its row would say; nothing while it has no pace and no shell line that could say. */
export function draftSentence(draft: AutomationDraft): string | undefined {
  const row = draftRow(draft)
  return row && pace(row)
}

/** Whether nothing has been typed into a draft yet: closing such a form loses nothing. */
export function isUntouched(draft: AutomationDraft): boolean {
  return draft.name === '' && draft.prompt === '' && draft.when === '' && draft.waitsFor === ''
}

/** What trying a shell line answered, as the page shows it. */
export interface TriedLine {
  /** The time the line was given as `$LAST_RUN`. */
  lastRun?: string
  /** What the line printed. */
  printed: string
  /** What it means: an agent would start, nothing to do, or the line failed and why. */
  verdict: string
  tone: 'start' | 'quiet' | 'failed'
}

/** Read what `agent-scheduler try` printed. Forgiving: an answer that is not what the command promises reads as a line that could not be tried. */
export function triedLine(output: unknown): TriedLine {
  const answer = typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {}
  const printed = typeof answer['printed'] === 'string' ? answer['printed'] : ''
  const lastRun = typeof answer['lastRun'] === 'string' ? { lastRun: answer['lastRun'] } : {}
  if (answer['ran'] !== true) return { ...lastRun, printed, verdict: `The line failed${typeof answer['error'] === 'string' && answer['error'] !== '' ? `: ${answer['error']}` : '.'}`, tone: 'failed' }
  return answer['due'] === true ? { ...lastRun, printed, verdict: 'It printed something: an agent would start now.', tone: 'start' } : { ...lastRun, printed, verdict: 'It printed nothing to do: no agent would start.', tone: 'quiet' }
}

/** Read what `agent-scheduler add` or `edit` printed: the file it wrote, where a run's checkout starts, whether it is kept on this machine alone, and the tool's name for what the file says now, when it gives one. */
export function savedFile(output: unknown): { file: string; startsFrom: string; onThisMachine: boolean; version?: string } {
  const answer = typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {}
  return { file: typeof answer['file'] === 'string' ? answer['file'] : 'a skill file', startsFrom: typeof answer['startsFrom'] === 'string' ? answer['startsFrom'] : 'HEAD', onThisMachine: answer['onThisMachine'] === true, ...(typeof answer['version'] === 'string' ? { version: answer['version'] } : {}) }
}

/** What a saved automation is and what the person has to do with it, in a sentence: a shared one is a file to commit that must reach where a run's checkout starts; one kept on this machine needs nothing. */
export function savedWords(saved: { startsFrom: string; onThisMachine: boolean }): string {
  if (saved.onThisMachine) return 'It is kept on this machine alone: nothing to commit, and nobody else gets the row. Its row can start as soon as you switch it on. Its prompt is in the record of each run, which is shared where this project shares its records.'
  return `It is a file of yours, in this project, and nothing was committed for you. ${startsWhen(saved.startsFrom)}`
}

/**
 * What a shared automation saved again is and what the person has to do with it, in a sentence:
 * a change to a file of theirs. An agent works in its own copy of the project, so it is told the
 * new words only once the change is where that copy starts, while the scheduler reads the pace and
 * the shell line from the person's own files. One kept on this machine needs nothing said: its row
 * shows the change.
 */
export function editedWords(saved: { startsFrom: string }): string {
  const once = saved.startsFrom === 'HEAD' ? 'once you commit the change' : `once the change is on ${saved.startsFrom}: commit it and bring it there`
  return `It is a change to a file of yours, in this project, and nothing was committed for you. An agent is told the new words only ${once}. The pace and the shell line are read from your file, so the scheduler uses the new ones from its next look. Its past runs, its switch and your picks for it stay.`
}

/**
 * What a row's panel says of where its picks are saved. A skill's row keeps them on this machine
 * and changes no tracked file. A row a person made keeps its words and its pace in its own file,
 * a change of theirs to commit when it is shared, and the rest on this machine.
 */
export function keptWhereHint(opened: OpenedAutomation | undefined): string {
  if (!opened) return 'Saved for you, in this project, on this machine. No tracked file changes.'
  return opened.draft.onThisMachine ? `Kept on this machine alone, outside git: ${opened.file}.` : `Its words and its pace are in a skill file of this project, ${opened.file}: a change to them is yours to commit. The rest is saved on this machine.`
}

/** What a row says before its automation is removed, for the person to confirm: what is deleted, what of it can be brought back, and what stays. */
export function removeWarning(command: { onThisMachine?: true }): string {
  const rest = 'Its switch and your picks for it go with it. The records of its past runs stay.'
  if (command.onThisMachine) return `Its file is deleted. It is kept on this machine alone, outside git, so it cannot be brought back. ${rest}`
  return `Its skill file is deleted from your files in this project, and nothing is committed for you. Git can bring back only what you committed of it: a file never committed, or your last changes to it, cannot be brought back. Everyone else who has the project keeps the row until your deletion reaches them. ${rest}`
}

/**
 * Read what `agent-scheduler remove` printed, and say what was removed and what is left for the
 * person to do, in a sentence: by what git still holds of a shared one's file. An answer that
 * does not say sends the person to git to look.
 */
export function removedWords(title: string, output: unknown): string {
  const answer = typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {}
  const file = typeof answer['file'] === 'string' ? answer['file'] : 'its file'
  const startsFrom = typeof answer['startsFrom'] === 'string' ? answer['startsFrom'] : 'HEAD'
  if (answer['onThisMachine'] === true) return `Removed ${title}: ${file} is deleted. Nothing is to commit.`
  if (answer['git'] === 'committed') return `Removed ${title}: ${file} is deleted, and nothing was committed for you. ${startsFrom === 'HEAD' ? 'Commit the deletion.' : `Commit the deletion and bring it to ${startsFrom}: until then everyone else who has the project keeps the row.`}`
  if (answer['git'] === 'staged') return `Removed ${title}: ${file} is deleted. It was staged and never committed, so a commit made now would still add it: take it out of the next commit with "git rm --cached ${file}".`
  if (answer['git'] === 'nothing') return `Removed ${title}: ${file} is deleted. Git never had the file, so nothing is to commit.`
  return `Removed ${title}: ${file} is deleted. What git holds of it could not be read: look with "git status".`
}

/** What the form says of where a draft will be saved, under its two choices. */
export function whereHint(draft: AutomationDraft): string {
  return draft.onThisMachine ? 'Kept on this machine alone, outside git. The row starts switched off, and can start as soon as you switch it on.' : 'Saved as a skill file in this project, which you commit. The row starts switched off.'
}

/** Where a saved automation's file has to get to before its row can start, in a sentence. */
export function startsWhen(startsFrom: string): string {
  return startsFrom === 'HEAD' ? 'Its row cannot start before you commit the file.' : `Its row cannot start before the file is on ${startsFrom}: commit it and bring it there.`
}
