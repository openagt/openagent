import { useState } from 'react'
import { Code, Eye, FolderIcon } from 'lucide-react'
import { Button, Markdown, Tooltip, TooltipContent, TooltipTrigger, useModuleHost, usePolled } from '@openagt/dashboard/module'
import type { FileContent } from '../src/read.js'
import { readContent } from './reads.js'
import { ContentView } from './ContentView.js'

// The right side of the Files pane: the file shown, under its path, as Claude Code on the web shows
// it. A Markdown file is shown rendered, with a button for its source. Read from the selected
// agent's worktree (#815), and read again every few seconds: the agent may be editing it.

const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path)

/** What stands on the right while no file is open. */
export function NoFileOpen() {
  return (
    <div className="flex flex-auto flex-col items-center justify-center gap-1 p-6 text-center">
      <FolderIcon aria-hidden className="mb-2 size-6 text-muted-foreground" />
      <p className="text-sm">Open files appear here</p>
      <p className="text-xs text-muted-foreground">Pick a file in the tree.</p>
    </div>
  )
}

export function FileView({ projectId, agentId, path, wrap }: { projectId: string; agentId?: string | undefined; path: string; wrap: boolean }) {
  const host = useModuleHost()
  const { value, loaded } = usePolled<FileContent | null>(() => readContent(host, projectId, path, agentId), null, 5_000, [projectId, agentId, path])
  // The files shown as their source, though they are Markdown: kept while the pane is open.
  const [source, setSource] = useState<ReadonlySet<string>>(new Set())
  const markdown = isMarkdown(path)
  const rendered = markdown && !source.has(path)
  const parts = path.split('/')

  return (
    <div className="flex min-h-0 min-w-0 flex-auto flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border pr-1 pl-3">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={path}>
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="px-1">/</span>}
              <span className={i === parts.length - 1 ? 'text-foreground' : undefined}>{part}</span>
            </span>
          ))}
        </p>
        {markdown && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={rendered ? 'Show the source' : 'Show it rendered'}
                  onClick={() => setSource(shown => (shown.has(path) ? new Set([...shown].filter(p => p !== path)) : new Set([...shown, path])))}
                />
              }
            >
              {rendered ? <Code className="size-3.5" /> : <Eye className="size-3.5" />}
            </TooltipTrigger>
            <TooltipContent>{rendered ? 'Source' : 'Rendered'}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="min-h-0 flex-auto overflow-auto">
        {!loaded ? (
          <p className="p-3 text-xs text-muted-foreground">Reading the file…</p>
        ) : !value ? (
          <p className="p-3 text-xs text-muted-foreground">Nothing to show.</p>
        ) : rendered && !value.binary ? (
          <div className="px-5 py-4">
            <Markdown text={value.text} />
          </div>
        ) : (
          <ContentView content={value} wrap={wrap} className="py-1" />
        )}
      </div>
    </div>
  )
}
