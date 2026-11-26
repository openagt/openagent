import { useMemo } from 'react'
import { Code, Eye, FolderIcon } from 'lucide-react'
import { Button, FileLinks, Markdown, PaneNote, PathCut, Skeleton, Slot, Tooltip, TooltipContent, TooltipTrigger, useModuleHost, usePolled } from '@openagt/ui/module'
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

export function FileView({ page, projectId, agentId, path, at, wrap, source, files, onOpen }: {
  /** The page whose open files these are (`open-files.ts`). */
  page: string
  projectId: string
  agentId?: string | undefined
  path: string
  /** Where the file is read, in a tree with a folder per repo: a copy of another repository (`repo`), or the project's own, and its path there. The tree's path otherwise. */
  at?: { repo?: string; path: string } | undefined
  wrap: boolean
  /** A Markdown file is shown as its source rather than rendered. */
  source: boolean
  /** The tree's files: what a rendered Markdown file's links to files open. */
  files: readonly string[]
  onOpen: (path: string, keep: boolean) => void
}) {
  const host = useModuleHost()
  const readPath = at?.path ?? path
  const repo = at?.repo
  const read = usePolled<FileContent | null>(() => readContent(host, projectId, readPath, agentId, ...(repo !== undefined ? [repo] : [])), null, 5_000, [projectId, agentId, readPath, repo], { remember: contentKey(projectId, agentId, path) })
  const markdown = isMarkdown(path)
  const rendered = markdown && !source
  const opens = useMemo(
    () => (name: string) => {
      const file = linkedFile(files, path, name)
      return file === undefined ? undefined : () => onOpen(file, false)
    },
    [files, path, onOpen],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-auto flex-col">
      {/* One line: the folders cut short first, so the file's name stays. */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hairline pr-1 pl-3">
        <p className="flex min-w-0 flex-1 text-sm" title={path}>
          <PathCut path={path} />
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
              {rendered ? <Code className="size-4" /> : <Eye className="size-4" />}
            </TooltipTrigger>
            <TooltipContent>{rendered ? 'Source' : 'Rendered'}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <Slot of={read} shape={<Lines />} className="flex min-h-0 flex-auto flex-col overflow-auto">
        {value =>
          !value ? (
            <PaneNote>This file is not here: it was deleted or moved, or it cannot be read.</PaneNote>
          ) : rendered && !value.binary && value.text ? (
            <div className="max-w-prose px-5 py-4">
              <FileLinks.Provider value={opens}>
                <Markdown text={value.text} look="document" />
              </FileLinks.Provider>
              {value.truncated && <Cut />}
            </div>
          ) : (
            <ContentView content={value} wrap={wrap} className="py-1" />
          )
        }
      </Slot>
    </div>
  )
}

/** A file's first lines while it is read, in its lines' shape. */
function Lines() {
  return (
    <div className="flex flex-col gap-1 px-3 py-1">
      {['w-1/2', 'w-2/3', 'w-1/3'].map(width => (
        <Skeleton key={width} className={`h-3 ${width}`} />
      ))}
    </div>
  )
}
