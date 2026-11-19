import { X } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The files picked into the agent Context (#661), listed like the repo rows but with an X to remove
// instead of a checkbox. Files reach the Context two ways — a `#` mention in the prompt (#504) and
// the right-rail file tree — and both add the same relative path to the shared context set.
// Without this they were invisible once the prompt was cleared; the X also unticks the file tree.
export function ContextFiles({
  files,
  onRemove,
  busy,
}: {
  /** The context entries that are files (not whole repos). */
  files: string[]
  /** Remove a file from the Context. */
  onRemove: (path: string) => void
  busy: boolean
}) {
  if (files.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {files.map(file => (
        <div key={file} className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(file)}
                  aria-label={`Remove ${file} from context`}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded text-muted-foreground hover:text-danger disabled:opacity-50"
                />
              }
            >
              <X className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>Remove {file}</TooltipContent>
          </Tooltip>
          <span className="truncate" title={file}>
            {file}
          </span>
        </div>
      ))}
    </div>
  )
}
