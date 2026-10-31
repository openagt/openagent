import { createContext, Fragment, useContext, type ReactNode } from 'react'
import { cn } from '@openagt/skill-ui/module'
import { CopyButton } from './ui/copy-button.js'

// A tiny, dependency-free Markdown renderer for an agent's replies, the surfaced PLAN/TODO docs
// and the agent's pushed views (#441). Builds React nodes (never injects HTML), so agent-written
// content can't smuggle markup. Handles what that content uses: headings, bullet, numbered and
// task lists (one inside another too), quotes, rules, fenced/inline code, bold/italic, links
// (#948 — plans and summaries carry PR/issue URLs the reader wants to click; http(s) only, so no
// javascript: smuggling), and pipe tables (#869 — an agent comparing options or listing files
// reaches for one, and it rendered as raw pipes). Anything else falls through as a paragraph.
// `compact` shrinks everything a notch (text-xs, smaller headings) so a reply reads at the density
// of the surrounding event log rather than a full document. Otherwise it is set as Claude Code on
// the web sets an answer: lines 20px apart, paragraphs a little further.
export function Markdown({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-1.5 text-xs leading-relaxed' : 'space-y-2.5 text-sm leading-5'}>
      {renderBlocks(text.replace(/\r\n/g, '\n').split('\n'), compact)}
    </div>
  )
}

/** The colour of one line of a `diff` block: what was added, what was removed, and where in the file. */
function diffLineClass(line: string): string | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-success'
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-danger'
  if (line.startsWith('@@')) return 'text-muted-foreground'
  return undefined
}

// A fenced-code block, rendered both when its closing fence arrives and when the doc ends
// mid-fence; one place so the markup and classes can't drift between the two. A block fenced as
// `diff` has its added and removed lines coloured, as the changed-lines counts are.
//
// A card, as Claude Code on the web sets one: a bordered box with the copy button in its corner,
// its lines wrapped to the box rather than cut at its edge, and no strip naming the language. Code
// is the one thing in an answer a reader takes somewhere else, and selecting it by hand is where
// that went wrong.
function codeBlock(lines: string[], language: string, key: number): ReactNode {
  const text = lines.join('\n')
  return (
    <div key={key} className="relative rounded-lg border border-border bg-muted/50">
      <CopyButton text={text} label="Copy the code" className="absolute top-2.5 right-2.5" />
      <pre className="px-4 py-3 pr-10 text-xs leading-[18px] break-words whitespace-pre-wrap">
        <code>
          {language === 'diff'
            ? lines.map((line, i) => (
                <span key={i} className={diffLineClass(line)}>
                  {i < lines.length - 1 ? `${line}\n` : line}
                </span>
              ))
            : text}
        </code>
      </pre>
    </div>
  )
}

/** A pipe-table row's cells, outer empties dropped (`| a | b |` -> ['a', 'b']). */
function tableCells(row: string): string[] {
  const cells = row.trim().split('|')
  if (cells[0]?.trim() === '') cells.shift()
  if (cells[cells.length - 1]?.trim() === '') cells.pop()
  return cells.map(c => c.trim())
}

/** The GFM header separator (`| --- | :-: |`), which is what makes pipe rows a table. */
function isTableSeparator(row: string): boolean {
  return tableCells(row).length > 0 && tableCells(row).every(c => /^:?-+:?$/.test(c))
}

/** A line with the tabs of its indent as spaces, a tab counting as one list level. */
function spaced(line: string): string {
  return line.replace(/^[ \t]*/, indent => indent.replace(/\t/g, '    '))
}

function indentOf(line: string): number {
  return /^ */.exec(spaced(line))![0].length
}

/** A line without the first `columns` of its indent; the rest of the line is left as written. */
function cutIndent(line: string, columns: number): string {
  let at = 0
  for (let cut = 0; at < line.length; at++) {
    const width = line[at] === ' ' ? 1 : line[at] === '\t' ? 4 : 0
    if (width === 0 || cut + width > columns) break
    cut += width
  }
  return line.slice(at)
}

/** A line that starts a list item: its indent, whether it is numbered (and its number), and its text. */
function listMarker(line: string): { indent: number; ordered: boolean; start: number; text: string } | null {
  const bullet = /^[ \t]*[-*]\s+(.*)$/.exec(line)
  if (bullet) return { indent: indentOf(line), ordered: false, start: 1, text: bullet[1]! }
  const numbered = /^[ \t]*(\d{1,3})[.)]\s+(.*)$/.exec(line)
  if (numbered) return { indent: indentOf(line), ordered: true, start: Number(numbered[1]), text: numbered[2]! }
  return null
}

/**
 * `---`, `***` or `___` alone on a line (or `- - -`): a rule between two parts of the text. Evenly
 * written only, so the first characters of a bullet that opens in bold (`* **`) are no rule while
 * the reply is still being written.
 */
function isRule(line: string): boolean {
  return /^\s*(?:([-*_])\1{2,}|([-*_])(?: \2){2,})\s*$/.test(line)
}

function isFence(line: string): boolean {
  return /^\s*```/.test(line)
}

/** How deep a quote in a quote or a list in a list is still drawn as one: past it the lines are plain text, so no text can nest without end. */
const MAX_DEPTH = 12

/**
 * Where the list that starts at `from` ends: the index of the first line past it. A list is its
 * items, what is indented under them (a list inside the list, a code block, more text), and the
 * blank lines between two items, which do not end it. A code block opened under an item is the
 * item's up to its closing fence, however its lines are indented.
 */
function listEnd(lines: string[], from: number): number {
  const base = listMarker(lines[from]!)!.indent
  let end = from + 1
  let fenced = false
  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (fenced) {
      if (isFence(line)) fenced = false
      end = i + 1
      continue
    }
    if (!line.trim()) continue
    const under = indentOf(line) >= base + 2
    const item = listMarker(line) !== null && !isRule(line)
    if (!under && !item) break
    if (under && isFence(line)) fenced = true
    end = i + 1
  }
  return end
}

/** One list's lines as its items; a change from bullets to numbers at the list's own level starts the next list. */
function renderList(lines: string[], compact: boolean, depth: number, key: number): ReactNode[] {
  const lists: ReactNode[] = []
  const first = listMarker(lines[0]!)!
  let ordered = first.ordered
  let start = first.start
  let items: ReactNode[] = []
  let text: string | null = null
  let under: string[] = []
  // How far the lines under the item are indented: what is cut off them. A code block's own lines
  // do not count: the code between its fences is cut together, by what the least indented of its
  // lines allows, so it keeps its shape.
  let margin = Infinity
  let fenced = false
  let fences: [from: number, to: number][] = []

  const closeFence = () => {
    if (!fenced) return
    fenced = false
    fences.at(-1)![1] = under.length - 1
  }

  const closeItem = () => {
    if (text === null) return
    closeFence()
    const task = /^\[([ xX])\]\s+(.*)$/.exec(text)
    const cuts = under.map(() => margin)
    for (const [from, to] of fences) {
      // The fence's own two lines are cut as any line under the item; the code between them together.
      const code = (i: number) => i > from && !isFence(under[i]!)
      let least = margin
      for (let i = from; i <= to; i++) if (code(i) && under[i]!.trim()) least = Math.min(least, indentOf(under[i]!))
      for (let i = from; i <= to; i++) if (code(i)) cuts[i] = least
    }
    const nested = under.length > 0 ? renderBlocks(under.map((l, i) => cutIndent(l, cuts[i]!)), compact, depth + 1) : null
    items.push(
      task ? (
        <li key={items.length} className="list-none -ml-4 flex items-start gap-2">
          <input type="checkbox" checked={task[1]!.toLowerCase() === 'x'} readOnly className="mt-1" />
          {nested ? (
            <div className="min-w-0 space-y-1">
              <span>{inline(task[2]!)}</span>
              {nested}
            </div>
          ) : (
            <span>{inline(task[2]!)}</span>
          )}
        </li>
      ) : (
        <li key={items.length} className={nested ? 'space-y-1' : undefined}>
          {inline(text)}
          {nested}
        </li>
      ),
    )
    text = null
    under = []
    margin = Infinity
    fences = []
  }
  // As Claude Code on the web sets a list: its words 35px in, 3px between two items, and, in a
  // message, twice the room under it before what follows.
  const look = cn(compact ? 'ml-6 space-y-1 [&>li]:pl-1' : 'ml-7 space-y-[3px] [&>li]:pl-[7px]', !compact && depth === 0 && '[&:not(:last-child)]:mb-[21px]')
  const closeList = () => {
    closeItem()
    if (items.length === 0) return
    lists.push(
      ordered ? (
        <ol key={`${key}-${lists.length}`} start={start} className={cn('list-decimal', look)}>
          {items}
        </ol>
      ) : (
        <ul key={`${key}-${lists.length}`} className={cn('list-disc', look)}>
          {items}
        </ul>
      ),
    )
    items = []
  }

  for (const line of lines) {
    if (fenced) {
      under.push(line)
      if (isFence(line)) closeFence()
      continue
    }
    const marker = listMarker(line)
    if (marker && marker.indent < first.indent + 2) {
      if (marker.ordered !== ordered) {
        closeList()
        ordered = marker.ordered
        start = marker.start
      }
      closeItem()
      text = marker.text
    } else if (line.trim()) {
      under.push(line)
      margin = Math.min(margin, indentOf(line))
      if (isFence(line)) {
        fenced = true
        fences.push([under.length - 1, under.length - 1])
      }
    } else if (under.length > 0) {
      // A blank line counts only between two lines that are under the item.
      under.push(line)
    }
  }
  closeList()
  return lists
}

function renderBlocks(lines: string[], compact = false, depth = 0): ReactNode[] {
  const blocks: ReactNode[] = []
  let code: { lines: string[]; language: string } | null = null
  let table: string[] = []
  let key = 0

  const flushTable = () => {
    if (table.length === 0) return
    const rows = table
    table = []
    // A real table needs the separator as its second row; anything else was just prose
    // with pipes, rendered as the paragraphs it would have been.
    if (rows.length >= 2 && isTableSeparator(rows[1]!)) {
      const header = tableCells(rows[0]!)
      const body = rows.slice(2).map(tableCells)
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((cell, i) => (
                  <th key={i} className="border-b border-border px-2 py-1 text-left font-semibold">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((cells, r) => (
                <tr key={r}>
                  {header.map((_, c) => (
                    <td key={c} className="border-b border-border/50 px-2 py-1 align-top">
                      {inline(cells[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    } else {
      for (const row of rows) blocks.push(<p key={key++}>{inline(row)}</p>)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = /^\s*```\s*([\w+-]*)/.exec(line)
    if (fence) {
      if (code === null) {
        flushTable()
        code = { lines: [], language: fence[1]!.toLowerCase() }
      } else {
        blocks.push(codeBlock(code.lines, code.language, key++))
        code = null
      }
      continue
    }
    if (code !== null) {
      code.lines.push(line)
      continue
    }

    // Consecutive `| … |` rows buffer into a table candidate; anything else flushes it.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      table.push(line)
      continue
    }
    flushTable()

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const sizes = compact
        ? ['text-sm', 'text-sm', 'text-xs', 'text-xs', 'text-xs', 'text-xs']
        : ['text-lg', 'text-base', 'text-sm', 'text-sm', 'text-sm', 'text-sm']
      blocks.push(
        <p key={key++} className={`font-semibold ${sizes[level - 1]}`}>
          {inline(heading[2]!)}
        </p>,
      )
      continue
    }

    if (isRule(line)) {
      blocks.push(<hr key={key++} className="border-border" />)
      continue
    }

    // A run of `>` lines is one quote, and what it quotes is text like any other.
    if (depth < MAX_DEPTH && /^\s*>/.test(line)) {
      let end = i
      while (end < lines.length && /^\s*>/.test(lines[end]!)) end++
      const quoted = lines.slice(i, end).map(l => l.replace(/^\s*>\s?/, ''))
      blocks.push(
        <blockquote key={key++} className="space-y-1.5 border-l-2 border-border pl-3 text-muted-foreground">
          {renderBlocks(quoted, compact, depth + 1)}
        </blockquote>,
      )
      i = end - 1
      continue
    }

    if (depth < MAX_DEPTH && listMarker(line)) {
      const end = listEnd(lines, i)
      for (const list of renderList(lines.slice(i, end), compact, depth, key++)) blocks.push(list)
      i = end - 1
      continue
    }

    if (line.trim()) blocks.push(<p key={key++}>{inline(line)}</p>)
  }
  flushTable()
  if (code !== null) blocks.push(codeBlock(code.lines, code.language, key++))
  return blocks
}

// Inline spans: `code`, [text](url), **bold**, *italic*, bare URLs, `#12`. Applied left-to-right,
// non-overlapping; code wins over the rest so a URL inside backticks stays literal, and what bold
// or italic wraps is read the same way, so a file name in bold is still code. Links
// render only for http(s) targets. A link to a file path (no scheme: `/repo/a.md`, `src/a.ts`)
// is the file's name as inline code with the path on hover: the browser cannot open a file, and
// the raw `[a.md](/repo/a.md)` read as noise. Anything else stays plain text.
const LINK_CLASS = 'text-primary underline underline-offset-2 break-all'
// A name in the text (a file, a branch, a command) is framed and coloured, so it stands out from
// the sentence around it, as Claude Code on the web sets one.
const CODE_CLASS = 'rounded-[5px] border-[0.5px] border-foreground/10 bg-foreground/5 px-[3px] py-px text-[0.9em] text-(--code-foreground)'
// `#12` as a link: the issue or pull request of that number, on the project's GitHub page.
const ISSUE_CLASS = 'whitespace-nowrap rounded bg-primary/10 px-1.5 text-primary hover:bg-primary/15'

/**
 * Where `#12` in an answer leads: the project's page on GitHub, under which `issues/12` opens the
 * issue or the pull request of that number. Given by the agent's page; without it `#12` is text.
 */
export const IssueLinks = createContext<string | undefined>(undefined)

function IssueRef({ number }: { number: string }) {
  const home = useContext(IssueLinks)
  if (!home) return `#${number}`
  return (
    <a href={`${home}/issues/${number}`} target="_blank" rel="noreferrer" className={ISSUE_CLASS}>
      #{number}
    </a>
  )
}

function link(href: string, label: string, key: number): ReactNode {
  return (
    <a key={key} href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      {label}
    </a>
  )
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = []
  const re = /(`[^`]+`|\[[^\]]+\]\((?:https?:\/\/)?[^\s):]+\)|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s<>)\]]+|(?<![\w/&#])#\d+\b)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    const token = m[0]
    if (token.startsWith('`')) parts.push(<code key={key++} className={CODE_CLASS}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('[')) {
      const parsed = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
      const file = /^\[([^\]]+)\]\(([^\s):]+)\)$/.exec(token)
      if (parsed) parts.push(link(parsed[2]!, parsed[1]!, key++))
      else if (file)
        parts.push(
          <code key={key++} title={file[2]} className={CODE_CLASS}>
            {file[1]}
          </code>,
        )
      else parts.push(<Fragment key={key++}>{token}</Fragment>)
    } else if (token.startsWith('**')) parts.push(<strong key={key++}>{inline(token.slice(2, -2))}</strong>)
    else if (token.startsWith('*')) parts.push(<em key={key++}>{inline(token.slice(1, -1))}</em>)
    else if (token.startsWith('#')) parts.push(<IssueRef key={key++} number={token.slice(1)} />)
    else parts.push(link(token, token, key++))
    last = m.index + token.length
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return parts
}
