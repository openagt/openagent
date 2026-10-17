import { Pieces, cn, useHighlighted } from '@openagt/dashboard/module'
import type { FileContent } from '../src/read.js'

/** Said under a file cut at the pane's cap, rendered or not. */
export function Cut() {
  return <p className="px-2 py-1 text-[10px] italic text-muted-foreground">Cut here. The rest is in the worktree.</p>
}

// What a file looks like in the pane: its contents (#828), coloured by its language as an editor
// colours them, with its lines numbered: they are how you say "line 40" to the session in the
// composer. No editing: the dashboard is not an editor (the risk raised on #475).
export function ContentView({ content, wrap = false, className }: { content: FileContent; wrap?: boolean; className?: string }) {
  const colored = useHighlighted(content.binary ? '' : content.text, content.path)
  if (content.binary) return <p className="p-2 text-xs text-muted-foreground">Binary file, nothing to show.</p>
  if (!content.text) return <p className="p-2 text-xs text-muted-foreground">Empty file.</p>
  const lines = content.text.split('\n')
  // The widest number, and the room after it: a padding inside the width would wrap a two-digit number.
  const width = `calc(${String(lines.length).length}ch + 0.75rem)`
  return (
    <div className={cn('overflow-auto font-mono text-xs leading-[17px]', className)}>
      {lines.map((line, i) => (
        <div key={i} className={cn('flex px-2 text-foreground', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>
          <span className="shrink-0 select-none pr-3 text-right tabular-nums text-muted-foreground/60" style={{ width }}>
            {i + 1}
          </span>
          <span>{colored?.[i] ? <Pieces pieces={colored[i]} /> : line || ' '}</span>
        </div>
      ))}
      {content.truncated && <Cut />}
    </div>
  )
}
