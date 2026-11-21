import { useState } from 'react'
import type { WorkspaceDoc } from '../../src/index.js'
import { Button } from './ui/button.js'
import { cn } from '../lib/utils.js'
import { Markdown } from './Markdown.js'
import { ScrollArea } from './ui/scroll-area.js'
import { PaneNote } from './PaneNote.js'
import { Skeleton } from './ui/skeleton.js'
import { Waiting } from './Waiting.js'

// The surfaced documents (#319/#328): the PLAN/TODO the agent writes, rendered beside the agent.
// The read lives in the rail (#1146), which needs to know whether there are any docs before it
// offers the pane; this renders what it is handed.
export function DocsPanel({ docs, loaded }: { docs: WorkspaceDoc[]; loaded: boolean }) {
  const [active, setActive] = useState(0)

  // Loading and empty are different facts (#948): without the guard, a project with docs
  // flashed "No PLAN/TODO docs yet." on every open while the first read was still out.
  if (!loaded)
    return (
      <Waiting shape={<Lines />} className="px-5 py-4" />
    )
  if (docs.length === 0) return <PaneNote>No PLAN/TODO docs yet.</PaneNote>

  const current = docs[Math.min(active, docs.length - 1)]!
  return (
    <div className="flex min-h-0 flex-auto flex-col">
      <div className="flex flex-wrap gap-1 border-b border-hairline p-2">
        {docs.map((d, i) => (
          <Button
            key={d.name}
            variant="ghost"
            size="sm"
            className={cn('h-7', i === active && 'bg-accent text-accent-foreground')}
            onClick={() => setActive(i)}
          >
            {d.name}
          </Button>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-auto">
        <div className="max-w-prose px-5 py-4">
          <Markdown text={current.content} look="document" />
        </div>
      </ScrollArea>
    </div>
  )
}

/** A document's first lines while it is read, in their shape. */
function Lines() {
  return (
    <div className="flex flex-col gap-2">
      {['w-1/3', 'w-2/3', 'w-1/2'].map(width => (
        <Skeleton key={width} className={`h-4 ${width}`} />
      ))}
    </div>
  )
}
