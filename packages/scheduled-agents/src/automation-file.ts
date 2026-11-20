import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { RUN_SKILLS_DIR, SKILL_FILE } from './names.js'

/**
 * The file of a person's own automation, written and read back. Shared with the project it is a
 * command skill's file (`.claude/skills/<name>/SKILL.md`); kept on this machine alone it is the
 * same text in the tool's own folder (`.scheduler/automations/<name>.md`). The front matter
 * makes it a command (`disable-model-invocation`) and carries the `schedule` the person picked;
 * the text after it is the prompt.
 *
 * The tool rewrites and removes a file only while the file reads as the tool writes one: rewriting
 * it then loses nothing a person wrote, and no skill a person or a package wrote is taken for an
 * automation.
 */

/** An automation as a person fills it in. */
export interface NewAutomation {
  /** The command's name, without its slash: the skill's folder. */
  name: string
  /** What the agent is told: the skill's whole text. */
  prompt: string
  /** How often at most, as a skill writes it (`15m`, `1d`). */
  every?: string
  /** The check, a shell line. */
  when?: string
  /** What the check waits for, in one plain line. */
  waitsFor?: string
}

/** How much of the prompt's first line stands as the skill's description, in characters. */
const DESCRIPTION_MAX = 150

/** Characters a quoted value writes as an escape beyond what JSON escapes: DEL and the C1 controls, the two Unicode line ends, the byte order mark. */
const SPECIALS = /[\u007f-\u009f\u2028\u2029\ufeff]/g

/** Characters a block cannot hold as typed: every control character but the line end, and the ones above. */
const CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\ufeff]/

/** A text with each half of a broken character pair replaced: such a half is no text a file holds. */
export function wellFormed(text: string): string {
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
}

/** The front matter of a skill file as written here, between its two lines of dashes. */
export function frontMatterOf(text: string): string {
  return text.slice(4, text.indexOf('\n---\n', 4))
}

/**
 * A text as a quoted value of the front matter: every character that could end the value, the
 * line or the front matter is written as an escape, three dashes in a row among them, since a
 * coding agent's reader ends the front matter at the first three dashes anywhere. Half of a
 * broken character pair, which no file holds as text, is replaced. It reads back as the text.
 */
function quoted(text: string): string {
  return JSON.stringify(wellFormed(text))
    .replace(SPECIALS, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replaceAll('---', '--\\u002d')
}

/**
 * Whether a check can stand in the file as a block, line for line as typed, the way the skills
 * write theirs: no character a block would lose or read as layout (a control character, blanks at
 * a line's end, blanks at its first line's start, where the block's indent is measured), and no
 * three dashes. Any other check is written quoted, on one line.
 */
function fitsBlock(check: string): boolean {
  if (CONTROLS.test(check) || check.includes('---')) return false
  const lines = check.split('\n')
  return lines[0] === lines[0]!.trimStart() && lines.every(line => line === line.trimEnd())
}

/**
 * The skill file of an automation: the front matter, then the prompt. The description is the
 * prompt's first line, cut short: it is what the row says the command does. Every text a person
 * typed is written quoted, so it can change no other key of the front matter, and the check as a
 * block where it can be, so it reads in the file as typed.
 */
export function automationSkill(automation: NewAutomation): string {
  const prompt = wellFormed(automation.prompt.trim())
  // Cut by whole characters: half an emoji is no text.
  const first = Array.from(prompt.split('\n')[0]!.trim())
  const description = first.length > DESCRIPTION_MAX ? `${first.slice(0, DESCRIPTION_MAX - 1).join('')}…` : first.join('')
  const when = automation.when === undefined ? undefined : wellFormed(automation.when.trim())
  const lines = [
    '---',
    `name: ${automation.name}`,
    `description: ${quoted(description)}`,
    'disable-model-invocation: true',
    // With neither a pace nor a check the schedule is an empty row, which the reader refuses in its own words.
    automation.every === undefined && when === undefined && automation.waitsFor === undefined ? 'schedule: {}' : 'schedule:',
    // A pace as the tool writes one stands as it is; anything else typed there is quoted, and the reader then says what is wrong with it.
    ...(automation.every !== undefined ? [`  every: ${/^\d+(m|h|d|w|mo)$/.test(automation.every) ? automation.every : quoted(automation.every)}`] : []),
    ...(automation.waitsFor !== undefined ? [`  waits-for: ${quoted(automation.waitsFor.trim())}`] : []),
    ...(when === undefined ? [] : fitsBlock(when) ? ['  when: |-', ...when.split('\n').map((line: string) => (line === '' ? '' : `    ${line}`))] : [`  when: ${quoted(when)}`]),
    '---',
    '',
    prompt,
    '',
  ]
  return lines.join('\n')
}

/**
 * The automation a file holds, when the file is what {@link automationSkill} writes for one;
 * nothing for any other file: a skill somebody wrote, or an automation changed by hand since it
 * was saved into something the tool does not write. What is read back, written again, is the
 * file itself, so rewriting it loses nothing.
 *
 * What the description says may differ, while its line is a quoted text as the tool writes it:
 * it is the prompt's first line, written anew with every save, so a person who changed that line
 * of the prompt by hand still has an automation, with a description a line behind. A description
 * written any other way is a person's, and the file a skill of theirs.
 */
export function automationOf(name: string, md: string): NewAutomation | undefined {
  const end = md.startsWith('---\n') ? md.indexOf('\n---\n', 4) : -1
  if (end < 0) return undefined
  let data: unknown
  try {
    data = parseYaml(md.slice(4, end))
  } catch {
    return undefined
  }
  const schedule = isMap(data) ? data['schedule'] : undefined
  if (!isMap(schedule)) return undefined
  const { every, when } = schedule
  const waitsFor = schedule['waits-for']
  const automation: NewAutomation = {
    name,
    prompt: md.slice(end + '\n---\n'.length).trim(),
    ...(every !== undefined ? { every: String(every) } : {}),
    ...(typeof when === 'string' ? { when } : {}),
    ...(typeof waitsFor === 'string' ? { waitsFor } : {}),
  }
  // A file with no such description is nothing the tool wrote: what the tool writes always has one.
  return butDescription(md) === butDescription(automationSkill(automation)) ? automation : undefined
}

/** A file without its description, where the tool writes it: on the third line, after the opening dashes and the name, as one quoted text and nothing after it. Nothing for a file with no such line. */
function butDescription(md: string): string | undefined {
  const lines = md.split('\n')
  const said = lines[2]?.startsWith('description: "') ? lines[2].slice('description: '.length) : undefined
  return said !== undefined && isQuoted(said) ? [...lines.slice(0, 2), ...lines.slice(3)].join('\n') : undefined
}

/** Whether a text is one quoted text as {@link quoted} writes it, whole: what follows a closing quote, a comment, is a person's writing. */
function isQuoted(text: string): boolean {
  try {
    return typeof JSON.parse(text) === 'string'
  } catch {
    return false
  }
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What a file manager leaves in a folder a person only looked at: no part of a skill, and it goes with the folder. */
export const FOLDER_LITTER = '.DS_Store'

/** What saving an automation again writes beside its file before moving it over the file: left behind only by a save that was cut short, it is the tool's own, no part of a skill, and it goes with the next save or with the folder. */
export const HALF_SAVED = `${SKILL_FILE}.new`

/**
 * Whether a skill's folder in the project is what saving a shared automation makes: a folder that
 * is no link, holding the skill's file, no link either, and nothing else but what a file manager
 * leaves behind and what a save of the tool's own that was cut short left. A skill that comes from a package is a link, and a skill with scripts beside its
 * file holds more: neither is an automation, whatever its file says.
 */
export async function standsAlone(repo: string, name: string): Promise<boolean> {
  const folder = join(repo, RUN_SKILLS_DIR, name)
  try {
    const [dir, entries] = await Promise.all([lstat(folder), readdir(folder)])
    // The leftover of a save is a file: a link or a folder of that name is somebody's, and writing through it would reach something kept elsewhere.
    const halfSaved = !entries.includes(HALF_SAVED) || (await isPlainFile(join(folder, HALF_SAVED)))
    return dir.isDirectory() && halfSaved && entries.every(entry => entry === SKILL_FILE || entry === FOLDER_LITTER || entry === HALF_SAVED) && (await isPlainFile(join(folder, SKILL_FILE)))
  } catch {
    return false
  }
}

/** Whether a path is a file and no link to one: writing or deleting a link would reach a file kept somewhere else. */
export async function isPlainFile(path: string): Promise<boolean> {
  return lstat(path).then(
    stat => stat.isFile(),
    () => false,
  )
}
