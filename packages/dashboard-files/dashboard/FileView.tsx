import { useMemo } from 'react'
import { Code, Eye, FolderIcon } from 'lucide-react'
import { Button, FileLinks, Markdown, Tooltip, TooltipContent, TooltipTrigger, useModuleHost, usePolled, Waiting } from '@openagt/dashboard/module'
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

/** What stands beside the tree while no file is open. */
export function NoFileOpen() {
  return (
    <div className="flex flex-auto flex-col items-center justify-center gap-1 p-6 text-center">
      <FolderIcon aria-hidden className="mb-2 size-6 text-muted-foreground" />
      <p className="text-sm">Open files appear here</p>
      <p className="text-xs text-muted-foreground">Pick a file in the tree.</p>
    </div>
  )
}

/**
 * The file of the tree a Markdown file's link names: by its place beside the Markdown file, else
 * from the project's root; none for a link to no file of it.
 */
export function linkedFile(files: readonly string[], from: string, name: string): string | undefined {
  const clean = name.replace(/[#?].*$/, '')
  if (clean === '') return undefined
  const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
  const parts: string[] = []
  for (const part of `${clean.startsWith('/') ? '' : folder}${clean}`.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  const beside = parts.join('/')
  if (files.includes(beside)) return beside
  const fromRoot = clean.replace(/^\.?\//, '')
  return files.includes(fromRoot) ? fromRoot : undefined
}

export function FileView({ page, projectId, agentId, path, wrap, source, files, onOpen }: {
  /** The page whose open files these are (`open-files.ts`). */
  page: string
  projectId: string
  agentId?: string | undefined
  path: string
  wrap: boolean
  /** A Markdown file is shown as its source rather than rendered. */
  source: boolean
  /** The tree's files: what a rendered Markdown file's links to files open. */
  files: readonly string[]
  onOpen: (path: string, keep: boolean) => void
}) {
  const host = useModuleHost()
  const { value, state } = usePolled<FileContent | null>(() => readContent(host, projectId, path, agentId), null, 5_000, [projectId, agentId, path], { remember: contentKey(projectId, agentId, path) })
  const markdown = isMarkdown(path)
  const rendered = markdown && !source
  const parts = path.split('/')
  const opens = useMemo(
    () => (name: string) => {
      const file = linkedFile(files, path, name)
      return file === undefined ? undefined : () => onOpen(file, false)
    },
    [files, path, onOpen],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-auto flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border pr-1 pl-3">
        <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" title={path}>
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
        {state === 'unknown' ? (
          <Waiting className="p-3">Reading the file…</Waiting>
        ) : !value ? (
          <p className="p-3 text-xs text-muted-foreground">This file is not here: it was deleted or moved, or it cannot be read.</p>
        ) : rendered && !value.binary && value.text ? (
          <div className="px-5 py-4">
            <FileLinks.Provider value={opens}>
              <Markdown text={value.text} document />
            </FileLinks.Provider>
            {value.truncated && <Cut />}
          </div>
        ) : (
          <ContentView content={value} wrap={wrap} className="py-1" />
        )}
      </div>
    </div>
  )
}
