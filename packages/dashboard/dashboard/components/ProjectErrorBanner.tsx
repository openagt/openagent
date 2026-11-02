import { TriangleAlert } from 'lucide-react'
import type { ProjectError, ProjectErrorCode } from '../../src/index.js'
import { formatAge } from '../lib/format-date.js'

// What the daemon currently finds wrong with the project (#1500), at the top of its page. The
// daemon records the state and clears it when the condition is gone (#1599: an agent-data branch that
// cannot reach origin), so this renders exactly what the project list carries — no state of its
// own, and nothing to dismiss: the way to make it go away is to fix the thing it names.

/** The one-line headline per kind of error; the detail underneath is the emitter's own message. */
export function projectErrorTitle(code: ProjectErrorCode): string {
  switch (code) {
    case 'data-sync':
      return 'Not syncing with the remote'
    case 'provider':
      return 'Unsettled: which package provides the data'
  }
}

export function ProjectErrorBanner({ errors }: { errors: ProjectError[] | undefined }) {
  if (!errors || errors.length === 0) return null
  return (
    <div className="flex flex-col gap-2 border-b border-danger/30 bg-danger/10 px-4 py-3">
      {errors.map(error => (
        <div key={error.code} role="alert" className="flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-danger">
              {projectErrorTitle(error.code)}
              {/* Since when, so a week-old failure does not read like a blip that will pass. */}
              <span className="font-normal text-muted-foreground"> · since {formatAge(error.since)}</span>
            </p>
            <p className="break-words text-muted-foreground">{error.message}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
