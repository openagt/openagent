/**
 * A ticket's file as the fields a person writes by hand: its priority and topics (two of the
 * lines above its title), its title and its text. The other lines above the title — `Issue:`,
 * `PR:`, `Waiting:` — are kept as they are: a page that edits a ticket never loses one.
 */
export interface TicketFields {
  /** `0`–`10`, or empty for none. */
  priority: string
  topics: string[]
  title: string
  /** Everything under the title, as markdown. */
  body: string
  /** The lines above the title this page does not edit, in their order. */
  kept: string[]
}

const PRIORITY = /^Priority:\s*(.*)$/
const TOPICS = /^Topics:\s*(.*)$/

/** Read a ticket's file into its fields. A file with no `# ` title reads with an empty one and its whole text as the body. */
export function readTicketFile(content: string): TicketFields {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex(line => line.startsWith('# '))
  const head = at < 0 ? [] : lines.slice(0, at).filter(line => line.trim() !== '')
  const fields: TicketFields = { priority: '', topics: [], title: at < 0 ? '' : lines[at]!.slice(2).trim(), body: '', kept: [] }
  for (const line of head) {
    const priority = PRIORITY.exec(line)
    const topics = TOPICS.exec(line)
    if (priority) fields.priority = priority[1]!.trim()
    else if (topics) fields.topics = topicsIn(topics[1]!)
    else fields.kept.push(line)
  }
  fields.body = (at < 0 ? lines : lines.slice(at + 1)).join('\n').trim()
  return fields
}

/** The file for `fields`: the lines above the title (priority and topics first, when set), the title, the text. */
export function writeTicketFile(fields: TicketFields): string {
  const head = [
    ...(fields.priority.trim() ? [`Priority: ${fields.priority.trim()}`] : []),
    ...(fields.topics.length > 0 ? [`Topics: [${fields.topics.join(', ')}]`] : []),
    ...fields.kept,
  ]
  const body = fields.body.trim()
  return `${head.length > 0 ? `${head.join('\n')}\n\n` : ''}# ${fields.title.trim()}\n${body ? `\n${body}\n` : ''}`
}

/** Topics as typed: separated by commas, brackets optional, blanks dropped, each lowercased once. */
export function topicsIn(text: string): string[] {
  return [...new Set(text.replace(/^\s*\[|\]\s*$/g, '').split(',').map(topic => topic.trim().toLowerCase()).filter(Boolean))]
}

/**
 * The filename for a new ticket titled `title` on `day` (yyyy-mm-dd): `<day>_<slug>.md`, the slug
 * the title in kebab case; a name `taken` already gets `-2`, `-3`… so a new ticket never
 * overwrites one.
 */
export function newTicketFile(title: string, day: string, taken: ReadonlySet<string>): string {
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'ticket'
  for (let n = 1; ; n++) {
    const file = `${day}_${slug}${n === 1 ? '' : `-${n}`}.md`
    if (!taken.has(file)) return file
  }
}
