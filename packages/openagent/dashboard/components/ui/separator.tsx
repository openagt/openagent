import type { ComponentProps } from 'react'
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { cn } from '../../lib/utils.js'

// shadcn's separator on Base UI (no Radix). A thin divider; the sidebar uses it between sections.
export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      orientation={orientation}
      data-slot="separator"
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
