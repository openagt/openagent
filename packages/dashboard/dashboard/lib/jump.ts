// What the jump (JumpPalette) lists for what is typed into it: its groups in their order, each place
// in the first group that has it, what matches best first. Typed into, every candidate is scored
// on each key, so it has to stay a plain pass over plain strings: a thousand runs are ranked in
// the frame of the key.

/** A place the jump goes to: a run, a page or a project. */
export interface JumpRow {
  /** One per place: a run's project and id, a page's segment, a project's id. */
  key: string
  name: string
  /** What else it is found by: a run's branch, its pull request's number. */
  also?: readonly string[]
}

export interface JumpCandidates<R extends JumpRow> {
  label: string
  rows: readonly R[]
  /** Rows read after what is typed now was typed: listed under the group's own, never among them. */
  later?: readonly R[]
  /** How many rows it shows at most; the rest are counted. */
  limit: number
  /** Listed only for something typed. */
  typedOnly?: boolean
}

export interface JumpGroup<R extends JumpRow> {
  label: string
  items: R[]
  /** How many more match than are shown. */
  more: number
}

/** Where `word` starts in `text`: at its start 3, at a word's 2, inside a word 1, nowhere 0. */
function found(text: string, word: string): number {
  const at = text.toLowerCase().indexOf(word)
  if (at < 0) return 0
  return at === 0 ? 3 : /[^\p{L}\p{N}]/u.test(text[at - 1]!) ? 2 : 1
}

/** How well a row matches the typed words, 0 when a word is in none of its texts: its name counts twice what else finds it. */
export function matchScore(row: JumpRow, words: readonly string[]): number {
  let score = 0
  for (const word of words) {
    const best = Math.max(2 * found(row.name, word), ...(row.also ?? []).map(text => found(text, word)))
    if (best === 0) return 0
    score += best
  }
  return score
}

/** The rows that match, best first; a tie keeps the rows' own order. */
function ranked<R extends JumpRow>(rows: readonly R[], words: readonly string[]): R[] {
  if (words.length === 0) return [...rows]
  return rows
    .map((row, at) => ({ row, at, score: matchScore(row, words) }))
    .filter(scored => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map(scored => scored.row)
}

/** The groups the jump shows for `query`, in the order given, empty ones left out. */
export function jumpGroups<R extends JumpRow>(candidates: readonly JumpCandidates<R>[], query: string): JumpGroup<R>[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const placed = new Set<string>()
  const groups: JumpGroup<R>[] = []
  for (const { label, rows, later = [], limit, typedOnly } of candidates) {
    const own = (list: readonly R[]) => list.filter(row => !placed.has(row.key) && placed.add(row.key))
    const mine = own(rows)
    const read = own(later)
    if (typedOnly && words.length === 0) continue
    const matched = [...ranked(mine, words), ...ranked(read, words)]
    if (matched.length > 0) groups.push({ label, items: matched.slice(0, limit), more: Math.max(0, matched.length - limit) })
  }
  return groups
}
