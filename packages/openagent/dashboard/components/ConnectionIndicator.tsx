import { Laptop, MonitorSmartphone } from 'lucide-react'
import { currentConnection } from '../lib/connection.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The "connected to <label>" indicator (#1052): which daemon the dashboard is talking to. Every
// transport is same-origin, so the browser's origin IS the connection — loopback is this machine's
// own daemon ("Local"), any other origin is another machine's, named by its address. It reads
// accented off Local so a remote box (where the agent runs on someone else's hardware) is never
// mistaken for your own.
export function ConnectionIndicator() {
  if (typeof window === 'undefined') return null
  const { label, isLocal } = currentConnection(window.location.host, window.location.hostname)
  const Icon = isLocal ? Laptop : MonitorSmartphone
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={
              isLocal
                ? // Folded away below sm with screen-size classes alone, as the wordmark is (BrandLink.tsx).
                  'items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground max-sm:hidden sm:inline-flex'
                : 'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-2 py-1 text-xs text-[var(--color-primary)]'
            }
          />
        }
      >
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-success" />
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="max-w-[10rem] truncate">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        {isLocal ? 'Connected to this machine' : `Connected to ${label} — the agent runs on that machine`}
      </TooltipContent>
    </Tooltip>
  )
}
