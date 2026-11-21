import { Laptop } from 'lucide-react'

/**
 * Where a row's run runs, when another computer started it and its record came through the
 * project's shared records (#1648): a laptop and the computer's name. The name is the first part of
 * the row to give up width.
 */
export function OnComputer({ computer }: { computer: { name: string } }) {
  return (
    <span className="flex min-w-0 max-w-40 shrink-[4] items-center gap-1 text-xs text-muted-foreground">
      <Laptop className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">on {computer.name}</span>
    </span>
  )
}
