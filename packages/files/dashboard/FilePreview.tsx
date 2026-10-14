import { PreviewCard, useModuleHost, usePolled } from '@openagt/dashboard/module'
import type { FileContent } from '../src/read.js'
import { readContent } from './reads.js'
import { ContentView } from './ContentView.js'

// Hover a file in the tree, see what is in it (#828). Clicking is already taken — it toggles the
// path in the agent Context (#504) — so hover is the free gesture. Base UI's PreviewCard is the
// hover-card primitive: it holds open while the pointer travels into the card, so a long body stays
// scrollable. The read resolves the selected agent's worktree (#815).
//
// The card is its own component because a closed PreviewCard does not mount its popup: mounting
// *is* opening, so the read is lazy by construction (nothing is fetched for the files you never
// point at) with no open-state bookkeeping.

export function FilePreviewCard({ projectId, agentId, path }: { projectId: string; agentId?: string | null | undefined; path: string }) {
  // Polled, not read once: the card is open over a session that is still editing, so what is under
  // the pointer keeps up rather than freezing at whatever it was when you hovered.
  const host = useModuleHost()
  const { value, loaded } = usePolled<FileContent | null>(() => readContent(host, projectId, path, agentId ?? undefined), null, 5_000, [projectId, agentId, path])

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{path}</span>
      </header>
      {!loaded ? (
        <p className="p-2 text-xs text-muted-foreground">Reading the file…</p>
      ) : !value ? (
        <p className="p-2 text-xs text-muted-foreground">Nothing to show.</p>
      ) : (
        <ContentView content={value} className="py-1" />
      )}
    </>
  )
}

export function FilePreviewHover({ projectId, agentId, path, children }: { projectId: string; agentId?: string | null | undefined; path: string; children: React.ReactNode }) {
  return (
    <PreviewCard.Root>
      {/* The tree's rows are `pointer-events-none` so only the label is clickable; the trigger has
          to take them back, or there is nothing to hover. */}
      <PreviewCard.Trigger delay={350} closeDelay={150} render={<div className="pointer-events-auto" />}>
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        {/* The layer is the positioner's, as every popup's is: on the popup inside it, it would count for nothing against the page. */}
        <PreviewCard.Positioner side="left" align="start" sideOffset={8} className="z-50">
          <PreviewCard.Popup className="flex max-h-[70vh] w-[42rem] max-w-[80vw] flex-col overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-lg">
            <FilePreviewCard projectId={projectId} agentId={agentId} path={path} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
