import { cn } from '../lib/utils.js'
import { BY_EXTENSION, BY_NAME, DEFAULT_ICON, ICONS, LIGHT } from './file-icons.generated.js'

// A file's icon from Material Icon Theme (MIT; `scripts/file-icons.mjs` writes the ones used): by
// the file's whole name first (`package.json`), then by its extension, the longest first
// (`a.d.ts` before `ts`), else the theme's plain file. The dashboard's own, so every pane that
// lists files draws them the same.

export function iconOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const named = BY_NAME[name]
  if (named) return named
  for (let dot = name.indexOf('.', 1); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    const icon = BY_EXTENSION[name.slice(dot + 1)]
    if (icon) return icon
  }
  return DEFAULT_ICON
}

const Picture = ({ icon, className }: { icon: string; className?: string | undefined }) => (
  <span aria-hidden className={cn('inline-flex size-4 shrink-0 [&>svg]:size-full', className)} dangerouslySetInnerHTML={{ __html: ICONS[icon]! }} />
)

/** A file's icon; an icon the theme draws differently on a light background has both, one per theme. */
export function FileIcon({ path, className }: { path: string; className?: string }) {
  const icon = iconOf(path)
  const light = LIGHT[icon]
  if (!light) return <Picture icon={icon} className={className} />
  return (
    <>
      <Picture icon={light} className={cn(className, 'dark:hidden')} />
      <Picture icon={icon} className={cn(className, 'hidden dark:inline-flex')} />
    </>
  )
}
