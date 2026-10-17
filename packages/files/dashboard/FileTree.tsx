import { useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Check, ChevronRight, Search } from 'lucide-react'
import { ContextMenu, ContextMenuTrigger, DropdownMenuContent, FileIcon, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, Input, cn, type ModuleContext } from '@openagt/dashboard/module'

// The Files pane's tree (#492): a lazy, collapsible tree built from the flat list of paths, with
// "Filter files…" over it. As in Claude Code on the web: one click on a file opens it as a
// preview, a double click keeps it open, and a right click opens a menu that attaches it to the
// next run's Context or copies its path or its name.
//
// Folders are native `<details>`: open/closed state, keyboard operation and the disclosure
// semantics come from the browser; a folder's contents exist only while it is open (see Folder).

type TreeNode = {
  name: string
  path: string
  dirs: Map<string, TreeNode>
  files: string[]
}

/** Build a nested tree from repo-relative paths like `src/dashboard/foo.ts`. */
function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', dirs: new Map(), files: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      const childPath = node.path ? `${node.path}/${seg}` : seg
      let child = node.dirs.get(seg)
      if (!child) {
        child = { name: seg, path: childPath, dirs: new Map(), files: [] }
        node.dirs.set(seg, child)
      }
      node = child
    }
    node.files.push(p)
  }
  return root
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
const ROW = 'flex h-6 w-full items-center gap-1.5 rounded-md px-2 text-start text-[13px] leading-[19px] hover:bg-accent'

/**
 * A folder row. Its contents are built only while it is open: a closed folder costs one row however
 * much lies under it, so the pane opens as fast on a large repository as on a small one, and a
 * re-render of the page does not walk every file of the repository.
 */
function Folder({ name, children }: { name: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="group" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className={cn(ROW, 'cursor-pointer list-none')}>
        <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground group-open:rotate-90" />
        <span className="truncate">{name}</span>
      </summary>
      {open && <div className="ml-3">{children()}</div>}
    </details>
  )
}

/** Put text on the clipboard; a page the browser refuses it to copies nothing. */
const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {})

/**
 * The keys that open a right-click menu, Shift+F10 and the Menu key, open the focused row's: Base
 * UI's menu opens on the pointer's right click only, which left the Context out of the keyboard's reach.
 */
function openMenuByKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault()
  const row = event.currentTarget.getBoundingClientRect()
  event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: row.left + 24, clientY: row.bottom }))
}

/** A file row: one click opens it as a preview, a double click keeps it, a right click opens its menu. */
function FileRow({ path, shown, attached, onOpen, onAttach }: {
  path: string
  shown: boolean
  attached: boolean
  onOpen: (path: string, keep: boolean) => void
  onAttach: (path: string) => void
}) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            title={path}
            onClick={() => onOpen(path, false)}
            onDoubleClick={() => onOpen(path, true)}
            onKeyDown={openMenuByKey}
            className={cn(ROW, shown && 'bg-accent')}
          />
        }
      >
        {/* The same width as a folder's chevron, so a file's name lines up with its folder's. */}
        <span className="flex w-3 shrink-0 justify-center">
          <FileIcon path={path} className="size-3" />
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {attached && <Check aria-label="In the Context" className="size-3.5 shrink-0 text-primary" />}
      </ContextMenuTrigger>
      <DropdownMenuContent className="min-w-[11rem]">
        <DropdownMenuItem onClick={() => onAttach(path)}>{attached ? 'Remove from context' : 'Attach as context'}</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Copy</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[9rem]">
            <DropdownMenuItem onClick={() => copy(path)}>Relative path</DropdownMenuItem>
            <DropdownMenuItem onClick={() => copy(name)}>Filename</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </ContextMenu>
  )
}

export function FileTree({ files, caption, shown, context, filter, onOpen }: {
  files: string[]
  /** Where a run's files were read from, said over the tree. */
  caption?: string | undefined
  /** The file the pane shows: its row is lit. */
  shown?: string | undefined
  context: ModuleContext
  /** "Filter files…", for the pane's search to put the cursor in. */
  filter?: RefObject<HTMLInputElement | null>
  onOpen: (path: string, keep: boolean) => void
}) {
  const [query, setQuery] = useState('')
  // A search narrows to matching files (and the folders on their way), so the tree is usable
  // on a large repo without scrolling. Empty query shows everything.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? files.filter(f => f.toLowerCase().includes(q)) : files
  }, [files, query])
  const tree = useMemo(() => buildTree(visible), [visible])

  const renderNode = (node: TreeNode) => (
    <>
      {[...node.dirs.values()].sort(byName).map(dir => (
        <Folder key={dir.path} name={dir.name}>
          {() => renderNode(dir)}
        </Folder>
      ))}
      {[...node.files]
        .sort((a, b) => a.localeCompare(b))
        .map(path => (
          <FileRow key={path} path={path} shown={path === shown} attached={context.files.has(path)} onOpen={onOpen} onAttach={context.toggle} />
        ))}
    </>
  )

  return (
    <div className="flex min-h-0 flex-auto flex-col px-2 pb-2">
      <div className="relative mt-1 mb-1.5">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref={filter} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter files…" aria-label="Filter files" className="h-6 bg-background pr-2 pl-7 text-[13px] shadow-none" />
      </div>
      {caption && <p className="px-1 pb-1 text-[10px] text-muted-foreground">{caption}</p>}
      {/* A query with zero hits used to render an empty pane, which reads as broken (#948). */}
      {query.trim() && visible.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">No files match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <>
          {query.trim() && (
            <p className="px-1 pb-1 text-[10px] text-muted-foreground">
              {visible.length} of {files.length} files
            </p>
          )}
          <div className="min-h-0 w-full flex-auto overflow-y-auto">{renderNode(tree)}</div>
        </>
      )}
    </div>
  )
}
