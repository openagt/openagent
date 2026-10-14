import { useState } from 'react'
import type { WorkspaceDoc } from '../../src/index.js'
import { Button } from './ui/button.js'
import { Markdown } from './Markdown.js'
import { cn } from '../lib/utils.js'
import { ScrollArea } from './ui/scroll-area.js'

// The surfaced documents (#319/#328): the PLAN/TODO the agent writes, rendered beside the agent.
// The read lives in the rail (#1146), which needs to know whether there are any docs before it
// offers the pane; this renders what it is handed.
export function DocsPanel({ docs, loaded }: { docs: WorkspaceDoc[]; loaded: boolean }) {
  const [active, setActive] = useState(0)

  // Loading and empty are different facts (#948): without the guard, a project with docs
  // flashed "No PLAN/TODO docs yet." on every open while the first read was still out.
  if (!loaded) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>
  if (docs.length === 0) return <p className="p-4 text-sm text-muted-foreground">No PLAN/TODO docs yet.</p>

  const current = docs[Math.min(active, docs.length - 1)]!
  return (
    <div className="flex min-h-0 flex-auto flex-col">
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        {docs.map((d, i) => (
          <Button
            key={d.name}
            variant="ghost"
            size="sm"
            className={cn('h-7 text-xs', i === active && 'bg-accent text-accent-foreground')}
            onClick={() => setActive(i)}
          >
            {d.name}
          </Button>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-auto">
        <div className="p-4">
          <Markdown text={current.content} />
        </div>
      </ScrollArea>
    </div>
  )
}
