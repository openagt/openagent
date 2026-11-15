import { cn } from '../../lib/utils.js'

/**
 * A row of navigation, the sidebar's and the Settings list's: 32 high (44 on a phone), its icon on the
 * row's axis. The picked row is filled with the text's colour at 8% and its icon is in the text's
 * colour; a row under the pointer at 4%, so the two are told apart at a glance; the weight never changes.
 */
export function navRowClass(active: boolean): string {
  return cn(
    'focus-ring flex w-full items-center gap-2 rounded-md px-1.5 text-sm font-normal text-foreground transition-colors md:h-8 max-md:h-11 [&>svg]:size-4 [&>svg]:shrink-0',
    active ? 'bg-foreground/8 [&>svg]:text-foreground' : 'hover:bg-foreground/4 active:bg-foreground/8 [&>svg]:text-muted-foreground',
  )
}

/**
 * The press that picks the project, over the rows it scopes: a card standing on the column (white
 * under a hairline and a faint lift), 40 high (44 on a phone), its name at 500.
 */
export const PROJECT_ROW_CLASS =
  'focus-ring flex w-full items-center gap-2 rounded-md bg-card px-2 text-sm font-medium text-foreground shadow-sm ring-1 ring-hairline transition-colors hover:bg-accent active:bg-accent md:h-10 max-md:h-11 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground'
