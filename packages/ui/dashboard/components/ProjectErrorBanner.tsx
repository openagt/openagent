import { TriangleAlert } from 'lucide-react'
import type { ProjectError } from '../../src/index.js'
import { formatAge } from '../lib/format-date.js'
import { Facts } from './ui/panel.js'

// What the person has to fix in the project (#1500), at the top of its page: what the modules on
// in it say needs setting up, each said until its condition is gone (#1599: an agent-data branch
// that cannot reach origin). This renders exactly what the project list carries — no state of its
// own, and nothing to dismiss: the way to make it go away is to fix the thing it names.

export function ProjectErrorBanner({ errors: all }: { errors: ProjectError[] | undefined }) {
  // One a press fixes is the page's card, with its press (ProjectItemsLine): said once, there.
  const errors = all?.filter(error => !error.fixed)
  if (!errors || errors.length === 0) return null
  return (
    // The banners' strip: a tinted fill with no edge, the mark in the danger's colour, the words in the text's.
    <div className="flex flex-col gap-2 bg-danger/10 px-4 py-3">
      {errors.map(error => (
        <div key={error.id} role="alert" className="flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">
              {/* Since when, so a week-old failure does not read like a blip that will pass. */}
              <Facts facts={[error.title, ...(error.since !== undefined ? [{ fact: `since ${formatAge(error.since)}`, className: 'font-normal text-muted-foreground' }] : [])]} />
            </p>
            {error.message !== undefined && <p className="whitespace-pre-line break-words text-muted-foreground">{error.message}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
