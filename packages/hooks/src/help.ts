/** The widest a line of a program's help is, so a terminal shows it whole. */
export const HELP_WIDTH = 100

/** The longest form that keeps its description on its own line; a longer one has the line to itself. */
const FORM_FITS = 28

/** One row of a program's help: a form and what it does. A lone string is a heading over the rows after it. */
export type HelpRow = readonly [form: string, description: string] | string

/**
 * Rows of a program's help: each form two columns in, every description from one column, a form
 * too long for it on a line of its own above its description, wrapped between its bracketed parts
 * where it is wider than the help. A description wraps on its column, and a newline in it starts
 * a new line there. A heading stands at the left, after a blank line.
 */
export function helpRows(rows: readonly HelpRow[]): string {
  const forms = rows.flatMap(row => (typeof row === 'string' ? [] : [row[0].length]))
  const column = 2 + Math.max(0, ...forms.filter(length => length <= FORM_FITS)) + 2
  const lines: string[] = []
  for (const row of rows) {
    if (typeof row === 'string') {
      if (lines.length) lines.push('')
      lines.push(row)
      continue
    }
    const [form, description] = row
    const said = description.split('\n').flatMap(part => wrapped(part, HELP_WIDTH - column))
    const first = said[0] !== undefined && form.length <= FORM_FITS ? said.shift() : undefined
    if (first !== undefined) lines.push(`  ${form.padEnd(column - 2)}${first}`)
    else lines.push(...wrapped(form, HELP_WIDTH - 6, formParts).map((line, i) => (i ? '      ' : '  ') + line))
    for (const line of said) lines.push(' '.repeat(column) + line)
  }
  return lines.join('\n')
}

/** A paragraph of a program's help, wrapped under {@link HELP_WIDTH}. */
export function helpText(paragraph: string): string {
  return wrapped(paragraph, HELP_WIDTH).join('\n')
}

/** A form's parts: its words, a bracketed part with what it holds kept as one. */
function formParts(form: string): string[] {
  const parts: string[] = []
  let depth = 0
  for (const word of form.split(' ')) {
    if (depth > 0) parts[parts.length - 1] += ` ${word}`
    else parts.push(word)
    depth += (word.match(/[[<]/g) ?? []).length - (word.match(/[\]>]/g) ?? []).length
  }
  return parts
}

/** `text` in lines of at most `width`, broken between its parts (its words unless said); a longer part has a line of its own. */
function wrapped(text: string, width: number, parts: (text: string) => string[] = words => words.split(' ')): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of parts(text).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}
