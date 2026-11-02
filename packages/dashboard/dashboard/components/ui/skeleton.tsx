import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.js'

// shadcn's skeleton: a muted, pulsing placeholder block. Used by SidebarMenuSkeleton.
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-accent', className)} {...props} />
}
