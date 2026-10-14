import { Code, Eye, FolderIcon } from 'lucide-react'
import { Button, Markdown, Tooltip, TooltipContent, TooltipTrigger, useModuleHost, usePolled } from '@openagt/dashboard/module'
import type { FileContent } from '../src/read.js'
import { readContent } from './reads.js'
import { contentKey } from './keys.js'
import { ContentView, Cut } from './ContentView.js'
import { showSource } from './open-files.js'

// The right side of the Files pane: the file shown, under its path, as Claude Code on the web shows
// it. A Markdown file is shown rendered, with a button for its source. Read from the selected
// agent's worktree (#815), and read again every few seconds: the agent may be editing it. A tab
// shown again shows what was read last at once.

const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path)

/** What stands on the right while no file is open. */
export function NoFileOpen({ tree }: { tree: boolean }) {
  return (
    <div className="flex flex-auto flex-col items-center justify-center gap-1 p-6 text-center">
      <FolderIcon aria-hidden className="mb-2 size-6 text-muted-foreground" />
      <p className="text-sm">Open files appear here</p>
      <p className="text-xs text-muted-foreground">{tree ? 'Pick a file in the tree.' : 'Show the file tree to pick a file.'}</p>
    </div>
  )
}

export function FileView({ page, projectId, agentId, path, wrap, source }: {
  /** The page whose open files these are (`open-files.ts`). */
  page: string
  projectId: string
  agentId?: string | undefined
  path: string
  wrap: boolean
  /** A Markdown file is shown as its source rather than rendered. */
  source: boolean
}) {
  const host = useModuleHost()
  const { value, loaded } = usePolled<FileContent | null>(() => readContent(host, projectId, path, agentId), null, 5_000, [projectId, agentId, path], { remember: contentKey(projectId, agentId, path) })
  const markdown = isMarkdown(path)
  const rendered = markdown && !source
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
                  onClick={() => showSource(page, path, rendered)}
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
          <p className="p-3 text-xs text-muted-foreground">This file is not here: it was deleted or moved, or it cannot be read.</p>
        ) : rendered && !value.binary && value.text ? (
          <div className="px-5 py-4">
            <Markdown text={value.text} />
            {value.truncated && <Cut />}
          </div>
        ) : (
          <ContentView content={value} wrap={wrap} className="py-1" />
        )}
      </div>
    </div>
  )
}
