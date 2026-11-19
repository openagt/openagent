/**
 * A skill's text as the dashboard writes it into a project: the package's `SKILL.md`, with the
 * version it is from stamped into its front matter as `metadata.version`. The stamp is what lets a
 * later dashboard tell three things apart when a project's text is not the one it carries:
 * the project's is older (a newer text is there to take), the project's was changed by hand (it is
 * never written over unasked), or the reader itself is the older one (it says nothing).
 */

const STAMP = /\nmetadata:\n  version: ([0-9A-Za-z.+-]+)\n---\n/

/** `text` with `version` stamped at the end of its front matter. A text with no front matter is given one. */
export function stamped(text: string, version: string): string {
  const stamp = `metadata:\n  version: ${version}\n`
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 3) : -1
  if (end === -1) return `---\n${stamp}---\n${text}`
  return `${text.slice(0, end + 1)}${stamp}${text.slice(end + 1)}`
}

/** A written file read back: the version it was stamped with, when it has a stamp, and the text without it. */
export function unstamped(file: string): { version?: string; text: string } {
  const match = file.startsWith('---\n') ? STAMP.exec(file) : null
  if (!match || match.index > file.indexOf('\n---\n', 3)) return { text: file }
  return { version: match[1]!, text: `${file.slice(0, match.index)}\n---\n${file.slice(match.index + match[0].length)}` }
}

/** Whether version `a` is older than `b`, by their numbers: `0.1.2` is older than `0.1.10`. Anything that is not three numbers compares as equal. */
export function olderThan(a: string, b: string): boolean {
  const parts = (v: string): number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
  }
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!
  return false
}
