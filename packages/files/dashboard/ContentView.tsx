import { cn } from '@openagt/dashboard/module'
import type { FileContent } from '../src/read.js'

/** Said under a file cut at the pane's cap, rendered or not. */
export function Cut() {
  return <p className="px-2 py-1 text-[10px] italic text-muted-foreground">Cut here. The rest is in the worktree.</p>
}

// What a file looks like in the pane: its contents (#828).
//
// Deliberately plain: no syntax highlighting, no editing. The dashboard is not an editor (the risk
// raised on #475) — this is here to answer "what is in this file", nothing more. Line numbers are
// what makes a plain body scannable, and they are how you say "line 40" to the session in the
// composer.
export function ContentView({ content, wrap = false, className }: { content: FileContent; wrap?: boolean; className?: string }) {
  if (content.binary) return <p className="p-2 text-xs text-muted-foreground">Binary file, nothing to show.</p>
  if (!content.text) return <p className="p-2 text-xs text-muted-foreground">Empty file.</p>
  const lines = content.text.split('\n')
  const width = `${String(lines.length).length + 1}ch`
  return (
    <div className={cn('overflow-auto font-mono text-[11px] leading-[1.45]', className)}>
      {lines.map((line, i) => (
        <div key={i} className={cn('flex px-2 text-foreground', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>
          <span className="shrink-0 select-none pr-3 text-right tabular-nums text-muted-foreground/60" style={{ width }}>
            {i + 1}
          </span>
          <span>{line || ' '}</span>
        </div>
      ))}
      {content.truncated && <Cut />}
    </div>
  )
}
