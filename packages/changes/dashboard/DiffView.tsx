import { cn } from '@openagt/dashboard/module'
import type { FileDiff } from '../src/diff.js'

// What a change looks like: a file's diff from git's unified output (#816).
//
// Deliberately plain: colored +/- lines, no syntax highlighting, no editing. The dashboard is
// not an editor (the risk raised on #475) — this is here to answer "what did the session do",
// nothing more.

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground'
  if (line.startsWith('@@')) return 'text-primary'
  // Both themes: the 300s wash out on a light background, the 700s on a dark one.
  if (line.startsWith('+')) return 'bg-success/10 text-success'
  if (line.startsWith('-')) return 'bg-danger/10 text-danger'
  return 'text-muted-foreground'
}

export function DiffView({ diff, className }: { diff: FileDiff; className?: string }) {
  if (diff.binary) return <p className="p-2 text-xs text-muted-foreground">Binary file, nothing to show.</p>
  return (
    <div className={cn('overflow-auto font-mono text-[11px] leading-[1.45]', className)}>
      {diff.patch.split('\n').map((line, i) => (
        <div key={i} className={cn('whitespace-pre px-2', lineClass(line))}>
          {line || ' '}
        </div>
      ))}
      {diff.truncated && <p className="px-2 py-1 text-[10px] italic text-muted-foreground">Cut here. The rest is in the worktree.</p>}
    </div>
  )
}
