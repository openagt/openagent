import { Children, cloneElement, createContext, Fragment, isValidElement, useContext, useRef, type ReactElement, type ReactNode } from 'react'
import { wordShownAt } from '../lib/use-steady-text.js'
import { ColouredLines, languageOfFence, useHighlightedIn } from '../lib/highlight.js'
import { cn } from '../lib/utils.js'
import { ImageIcon } from 'lucide-react'
import { CopyButton } from './ui/copy-button.js'
import { Checkbox } from './ui/checkbox.js'

// A tiny, dependency-free Markdown renderer for an agent's replies, the surfaced PLAN/TODO docs
// and the agent's pushed views (#441). Builds React nodes (never injects HTML), so agent-written
// content can't smuggle markup. Handles what that content uses: headings, bullet, numbered and
// task lists (one inside another too), quotes, rules, fenced/inline code, bold/italic, links
// (#948 — plans and summaries carry PR/issue URLs the reader wants to click; http(s) only, so no
// javascript: smuggling), and pipe tables (#869 — an agent comparing options or listing files
// reaches for one, and it rendered as raw pipes). Anything else falls through as a paragraph.
// `compact` shrinks everything a notch (text-xs, smaller headings) so a reply reads at the density
// of the surrounding event log rather than a full document. Otherwise it is set as Claude Code on
// the web sets an answer: 15px text, lines 21px apart, paragraphs 8px further; code at 13px.
//
// `document` is for a file read as a page (the Files pane's Markdown, a workspace doc), set as
// Claude Code on the web's file preview sets one: the lines of a paragraph wrapped in its source
// are one paragraph, headings are larger with room above them, a table is a bordered card that
// scrolls sideways, a code block names its language and scrolls rather than wraps. Without it,
// each line is its own paragraph, as a reply in the chat means its lines.
//
// `fade` is for the message being written: each word comes in out of nothing, once. A word drawn
// again, in this box or in the one that takes its place, goes on from where its fade was: its time
// is kept by its place among the message's words (`use-steady-text.ts`).
export function Markdown({ text, compact = false, fade = false, document = false }: { text: string; compact?: boolean; fade?: boolean; document?: boolean }) {
  const drawnAt = useRef(performance.now()).current
  const blocks = renderBlocks(text.replace(/\r\n/g, '\n').split('\n'), { compact, document })
  return (
    <div data-markdown className={compact ? 'space-y-1.5 text-xs leading-relaxed' : document ? 'space-y-2.5 font-serif text-[15px] leading-6' : 'space-y-2 text-[15px] leading-[21px]'}>
      {fade ? wordsIn(blocks, { at: 0 }, drawnAt, text) : blocks}
    </div>
  )
}

/** How the text is set: a notch smaller (`compact`), or as a page (`document`). */
interface Look {
  compact: boolean
  document: boolean
}

/**
 * What a file named in the text opens, by the name as written (`.github/workflows/deploy.yml`):
 * given where the text is a file of the project, as the Files pane's Markdown is; none for a name
 * that is no file there, or where nothing opens files.
 */
export const FileLinks = createContext<((path: string) => (() => void) | undefined) | undefined>(undefined)

/** How long a word takes to come in (`.word-in`). */
const WORD_IN_MS = 500

/** The text of what was rendered, a word to a span. Code stays as it is: it comes whole, and its lines are not words. */
function wordsIn(node: ReactNode, count: { at: number }, drawnAt: number, message: string): ReactNode {
  return Children.map(node, child => {
    if (typeof child === 'string') {
      return child.split(/(\s+)/).map((word, at) => {
        if (word.trim() === '') return word
        const since = drawnAt - wordShownAt(message, count.at++)
        // Already in before this box was drawn: plain. Coming in: from where it was.
        if (since >= WORD_IN_MS) return <span key={at}>{word}</span>
        return (
          <span key={at} className="word-in" style={since > 0 ? { animationDelay: `${-since}ms` } : undefined}>
            {word}
          </span>
        )
      })
    }
    if (!isValidElement(child) || child.type === 'pre' || child.type === 'code') return child
    const element = child as ReactElement<{ children?: ReactNode }>
    return element.props.children === undefined ? element : cloneElement(element, undefined, wordsIn(element.props.children, count, drawnAt, message))
  })
}

/** The colour of one line of a `diff` block: what was added, what was removed, and where in the file. */
function diffLineClass(line: string): string | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-success'
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-danger'
  if (line.startsWith('@@')) return 'text-muted-foreground'
  return undefined
}

/**
 * A fenced-code block, drawn both when its closing fence arrives and when the doc ends mid-fence.
 * A block fenced as `diff` has its added and removed lines coloured, as the changed-lines counts
 * are; a block of a language the dashboard knows is coloured in the chat's own colours
 * (`highlight.tsx`), as Claude Code on the web colours one; until its grammar is loaded, and for a
 * language it does not know, the text is plain.
 *
 * A card, as Claude Code on the web sets one: a bordered box with the copy button in its corner,
 * its lines wrapped to the box rather than cut at its edge, and no strip naming the language. Code
 * is the one thing in an answer a reader takes somewhere else, and selecting it by hand is where
 * that went wrong.
 */
function CodeBlock({ lines, language, document }: { lines: string[]; language: string; document: boolean }) {
  const text = lines.join('\n')
  const known = language === 'diff' ? undefined : languageOfFence(language)
  const coloured = useHighlightedIn(text, known)
  // In a page, as Claude Code on the web's file preview sets one: as wide as the text, the language
  // it was fenced as beside the copy button, and its lines kept whole, the box scrolling sideways.
  return (
    <div className={cn('relative max-w-full rounded-lg border border-border', document ? 'w-full' : 'w-fit min-w-40')}>
      <div className="absolute top-2.5 right-2.5 flex items-center gap-2">
        {document && language !== '' && <span className="text-xs text-muted-foreground">{language}</span>}
        <CopyButton text={text} label="Copy the code" />
      </div>
      <pre className={cn('py-3 pl-4 text-[13px] leading-[19px]', document ? 'overflow-x-auto pr-20 whitespace-pre' : 'pr-12 break-words whitespace-pre-wrap')}>
        <code>
          {language === 'diff'
            ? lines.map((line, i) => (
                <span key={i} className={diffLineClass(line)}>
                  {i < lines.length - 1 ? `${line}\n` : line}
                </span>
              ))
            : coloured
              ? <ColouredLines lines={coloured} />
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
function renderList(lines: string[], look: Look, depth: number, key: number): ReactNode[] {
  const { compact } = look
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
    const nested = under.length > 0 ? renderBlocks(under.map((l, i) => cutIndent(l, cuts[i]!)), look, depth + 1) : null
    items.push(
      task ? (
        <li key={items.length} className="list-none -ml-4 flex items-start gap-2">
          {/* The page's own checkbox, in the theme's primary colour, never the browser's. */}
          <Checkbox checked={task[1]!.toLowerCase() === 'x'} readOnly aria-label={task[1]!.toLowerCase() === 'x' ? 'Done' : 'To do'} className="mt-[3px]" />
          {nested ? (
            <div className="min-w-0 space-y-1">
              <TaskWords done={task[1]!.toLowerCase() === 'x'} text={task[2]!} />
              {nested}
            </div>
          ) : (
            <TaskWords done={task[1]!.toLowerCase() === 'x'} text={task[2]!} />
          )}
        </li>
      ) : (
        <li key={items.length} className={nested ? 'space-y-1' : undefined}>
          {inlineLines(text)}
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
  const set = cn(compact ? 'ml-6 space-y-1 [&>li]:pl-1' : 'ml-7 space-y-[3px] [&>li]:pl-[7px]', !compact && depth === 0 && '[&:not(:last-child)]:mb-[21px]')
  const closeList = () => {
    closeItem()
    if (items.length === 0) return
    lists.push(
      ordered ? (
        <ol key={`${key}-${lists.length}`} start={start} className={cn('list-decimal', set)}>
          {items}
        </ol>
      ) : (
        <ul key={`${key}-${lists.length}`} className={cn(depth > 0 ? 'list-[circle]' : 'list-disc', set)}>
          {items}
        </ul>
      ),
    )
    items = []
  }

  for (const [at, line] of lines.entries()) {
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
    } else if (look.document && text !== null && under.length === 0 && line.trim() && !startsBlock(line)) {
      // In a page, a line right under the item's own words goes on with them, as a paragraph's does.
      text = `${text.trimEnd()}${lineBreak(lines[at - 1]!)}${line.trim()}`
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

/** A tag alone on its line that only lays out what follows: an opening or closing `<p>`, `<div>`, `<picture>`…, or a `<br>`. */
function isLayoutTag(line: string): boolean {
  return /^\s*<\/?(?:p|div|center|picture|source|span|details|summary)\b[^>]*>\s*$/i.test(line) || /^\s*<br\b[^>]*>\s*$/i.test(line)
}

/** A line that starts a block of its own rather than going on with the paragraph above it. */
function startsBlock(line: string): boolean {
  return isLayoutTag(line) || /^\s*<h[1-6]\b/i.test(line) || isFence(line) || /^\s*\|.*\|\s*$/.test(line) || /^#{1,6}\s/.test(line) || isRule(line) || /^\s*>/.test(line) || listMarker(line) !== null
}

/**
 * What joins a paragraph's line to the next: a space, or a new line where the line ended in two
 * spaces or a backslash, as Markdown breaks a line.
 */
function lineBreak(line: string): string {
  return / {2,}$|\\$/.test(line) ? '\n' : ' '
}

/** A task's words: struck through and dimmed once done, as Claude Code on the web sets them. */
function TaskWords({ done, text }: { done: boolean; text: string }) {
  return <span className={done ? 'text-muted-foreground line-through' : undefined}>{inlineLines(text)}</span>
}

/** A paragraph's text, a line break where its lines were broken (`lineBreak`). */
function inlineLines(text: string): ReactNode {
  if (!text.includes('\n')) return inline(text)
  return text.split('\n').map((line, at) => (
    <Fragment key={at}>
      {at > 0 && <br />}
      {inline(line)}
    </Fragment>
  ))
}

/**
 * A page's table, as Claude Code on the web's file preview sets one: a bordered card, its header
 * row shaded, a line between two rows; its first column kept on one line and the others at least
 * wide enough to read, the card scrolling sideways when the page is narrower than that.
 */
function PageTable({ header, body }: { header: string[]; body: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} className="border-b border-border bg-muted/50 px-3 py-[7px] text-left font-semibold">
                {inline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, r) => (
            <tr key={r}>
              {header.map((_, c) => (
                <td key={c} className={cn('px-3 py-[7px] align-top', r > 0 && 'border-t border-border', c === 0 ? 'whitespace-nowrap' : 'min-w-40')}>
                  {inline(cells[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A reply's table: rows ruled under, as wide as the reply, scrolling sideways when it is wider. Its
 * elements, not a component of its own: the words of a message being written fade in through
 * the elements they are in (`wordsIn`), which a component's would hide.
 */
function replyTable(header: string[], body: string[][], compact: boolean, key: number): ReactNode {
  return (
    <div key={key} className="overflow-x-auto">
      <table className={cn('w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0', compact ? 'text-xs' : 'text-sm')}>
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} className={cn('border-b border-border text-left font-medium', compact ? 'py-1 pr-3' : 'py-2.5 pr-6')}>
                {inline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, r) => (
            <tr key={r}>
              {header.map((_, c) => (
                <td key={c} className={cn('border-b border-border/60 align-top', compact ? 'py-1 pr-3' : 'py-2.5 pr-6')}>
                  {inline(cells[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A heading as a link to it names it (`#deploy` for "Deploy"), as GitHub names one. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** A page's heading: larger the higher it is, with room above it, as Claude Code on the web's file preview sets one. */
function Heading({ level, text }: { level: number; text: string }) {
  const Tag = `h${Math.min(level, 6)}` as 'h1'
  const size = ['text-[26px] leading-[30px] font-medium', 'text-xl leading-[25px] font-medium', 'text-lg font-semibold', 'font-semibold', 'font-semibold', 'font-semibold'][level - 1]
  return (
    <Tag data-heading={slug(text)} className={cn(size, level > 1 && 'pt-7 first:pt-0')}>
      {inline(text)}
    </Tag>
  )
}

function renderBlocks(lines: string[], look: Look, depth = 0): ReactNode[] {
  const { compact, document } = look
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
      blocks.push(document ? <PageTable key={key++} header={header} body={body} /> : replyTable(header, body, compact, key++))
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
        blocks.push(<CodeBlock key={key++} lines={code.lines} language={code.language} document={document} />)
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

    // HTML a README lays itself out with: a tag alone on its line that only places what follows
    // (`<p align="center">`, `</div>`, `<br clear="left" />`) is no text; a heading in HTML is a heading.
    if (isLayoutTag(line)) continue
    const htmlHeading = /^\s*<h([1-6])\b[^>]*>(.*?)<\/h\1>\s*$/i.exec(line)
    const heading = htmlHeading ? ([line, '#'.repeat(Number(htmlHeading[1])), htmlHeading[2]!] as const) : /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      if (document) {
        blocks.push(<Heading key={key++} level={level} text={heading[2]!} />)
        continue
      }
      // As Claude Code on the web sets a reply's headings: the first a little larger than the text,
      // the others its size, none heavier than medium, with room above them.
      const sizes = compact
        ? ['text-sm', 'text-sm', 'text-xs', 'text-xs', 'text-xs', 'text-xs']
        : ['text-[17px] leading-6', 'text-[15px]', 'text-[15px]', 'text-[15px]', 'text-[15px]', 'text-[15px]']
      blocks.push(
        <p key={key++} data-heading={slug(heading[2]!)} className={cn(sizes[level - 1], compact ? 'font-semibold' : 'font-medium [&:not(:first-child)]:pt-2')}>
          {inline(heading[2]!)}
        </p>,
      )
      continue
    }

    if (isRule(line)) {
      blocks.push(<hr key={key++} className={cn('border-border', !compact && 'my-3')} />)
      continue
    }

    // A run of `>` lines is one quote, and what it quotes is text like any other.
    if (depth < MAX_DEPTH && /^\s*>/.test(line)) {
      let end = i
      while (end < lines.length && /^\s*>/.test(lines[end]!)) end++
      const quoted = lines.slice(i, end).map(l => l.replace(/^\s*>\s?/, ''))
      blocks.push(
        // In a page the quote keeps the text's colour, as Claude Code on the web's file preview sets one; in a reply it is dimmed.
        <blockquote key={key++} className={cn('space-y-1.5 border-l-4 border-border pl-4', document ? 'text-foreground' : 'text-muted-foreground', !compact && 'my-3 ml-2')}>
          {renderBlocks(quoted, look, depth + 1)}
        </blockquote>,
      )
      i = end - 1
      continue
    }

    if (depth < MAX_DEPTH && listMarker(line)) {
      const end = listEnd(lines, i)
      for (const list of renderList(lines.slice(i, end), look, depth, key++)) blocks.push(list)
      i = end - 1
      continue
    }

    if (!line.trim()) continue
    // In a page, the lines up to a blank one or the start of another block are one paragraph.
    let paragraph = line.trim()
    while (document && i + 1 < lines.length && lines[i + 1]!.trim() && !startsBlock(lines[i + 1]!)) paragraph = `${paragraph}${lineBreak(lines[i]!)}${lines[++i]!.trim()}`
    blocks.push(<p key={key++}>{inlineLines(paragraph)}</p>)
  }
  flushTable()
  if (code !== null) blocks.push(<CodeBlock key={key++} lines={code.lines} language={code.language} document={document} />)
  return blocks
}

// Inline spans: `code`, [text](url), **bold**, *italic*, bare URLs, `#12`. Applied left-to-right,
// non-overlapping; code wins over the rest so a URL inside backticks stays literal, and what bold
// or italic wraps is read the same way, so a file name in bold is still code. Links
// render only for http(s) targets. A link to a file path (no scheme: `/repo/a.md`, `src/a.ts`)
// is the file's name as inline code with the path on hover: the browser cannot open a file, and
// the raw `[a.md](/repo/a.md)` read as noise. Anything else stays plain text.
const LINK_CLASS = 'text-primary underline underline-offset-2 break-all'
// A name in the text (a file, a branch, a command) is on a faint fill, so it stands out from the
// sentence around it, as Claude Code on the web sets one.
const CODE_CLASS = 'rounded-[4px] bg-foreground/[0.075] px-1 py-px text-[0.9em]'
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

/**
 * A name in backticks. One that is a path of a file the text's project has (`src/a.ts`, with a
 * slash: a bare `index.html` is a name as often as a file) opens it, as Claude Code on the web's
 * file preview links one; any other is code.
 */
function InlineCode({ text }: { text: string }) {
  const opens = useContext(FileLinks)
  const open = text.includes('/') ? opens?.(text) : undefined
  if (open) return <FileButton label={text} path={text} open={open} />
  return <code className={CODE_CLASS}>{text}</code>
}

/** A link to a file (`[a.md](docs/a.md)`): opens it where files open, else its name as code, its path on hover. */
function FileLink({ label, path }: { label: string; path: string }) {
  const open = useContext(FileLinks)?.(path)
  if (open) return <FileButton label={label} path={path} open={open} />
  return (
    <code title={path} className={CODE_CLASS}>
      {label}
    </code>
  )
}

function FileButton({ label, path, open }: { label: string; path: string; open: () => void }) {
  return (
    <button type="button" title={`Open ${path}`} onClick={open} className={cn(LINK_CLASS, 'text-left')}>
      {label}
    </button>
  )
}

/** A link to a heading of the same text (`[Deploy](#deploy)`): scrolls to it. */
function HeadingLink({ label, to }: { label: string; to: string }) {
  return (
    <a
      href={`#${to}`}
      onClick={event => {
        event.preventDefault()
        const heading = [...(event.currentTarget.closest('[data-markdown]')?.querySelectorAll<HTMLElement>('[data-heading]') ?? [])].find(found => found.dataset.heading === to.toLowerCase())
        heading?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }}
      className={LINK_CLASS}
    >
      {label}
    </a>
  )
}

/** An attribute of an HTML tag as the text wrote it: `alt="OpenAgent"`. */
function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag)?.[1]
}

/**
 * An image in the text (a badge, a logo), as Claude Code on the web shows one: not loaded, which
 * would reach whatever server the text names, but a chip with an image's mark and the image's own
 * words. One that is a link's label is that link.
 */
function ImageChip({ alt, href }: { alt: string; href?: string }) {
  const opens = useContext(FileLinks)
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 align-middle text-[0.9em] text-foreground">
      <ImageIcon aria-hidden className="size-3.5 shrink-0" />
      {alt || 'Image'}
    </span>
  )
  if (href === undefined) return chip
  if (/^https?:\/\//.test(href))
    return (
      <a href={href} target="_blank" rel="noreferrer" className="hover:opacity-80">
        {chip}
      </a>
    )
  const open = opens?.(href)
  return open ? (
    <button type="button" title={`Open ${href}`} onClick={open} className="hover:opacity-80">
      {chip}
    </button>
  ) : (
    chip
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
  const re = /(`[^`]+`|\[!\[[^\]]*\]\([^\s)]+\)\]\([^\s)]+\)|!\[[^\]]*\]\([^\s)]+\)|<img\b[^>]*>|<a\s[^>]*>[^<]*<\/a>|<br\s*\/?>|\[[^\]]+\]\((?:https?:\/\/)?[^\s):]+\)|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s<>)\]]+|(?<![\w/&#])#\d+\b)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    const token = m[0]
    if (token.startsWith('`')) parts.push(<InlineCode key={key++} text={token.slice(1, -1)} />)
    else if (token.startsWith('[![') || token.startsWith('![')) {
      // An image, alone or as a link's whole label: `![npm](…badge.svg)`, `[![npm](…)](…/package)`.
      const image = /!\[([^\]]*)\]\(([^\s)]+)\)(?:\]\(([^\s)]+)\))?/.exec(token)!
      parts.push(<ImageChip key={key++} alt={image[1]!} {...(image[3] !== undefined ? { href: image[3] } : {})} />)
    } else if (/^<img\b/i.test(token)) parts.push(<ImageChip key={key++} alt={attribute(token, 'alt') ?? ''} />)
    else if (/^<a\s/i.test(token)) {
      const href = attribute(token, 'href')
      const label = token.replace(/^<a\s[^>]*>|<\/a>$/gi, '')
      parts.push(href && /^https?:\/\//.test(href) ? link(href, label, key++) : href ? <FileLink key={key++} label={label} path={href} /> : <Fragment key={key++}>{label}</Fragment>)
    } else if (/^<br/i.test(token)) parts.push(<br key={key++} />)
    else if (token.startsWith('[')) {
      const parsed = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
      const file = /^\[([^\]]+)\]\(([^\s):]+)\)$/.exec(token)
      if (parsed) parts.push(link(parsed[2]!, parsed[1]!, key++))
      else if (file?.[2]!.startsWith('#')) parts.push(<HeadingLink key={key++} label={file[1]!} to={file[2]!.slice(1)} />)
      else if (file) parts.push(<FileLink key={key++} label={file[1]!} path={file[2]!} />)
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
