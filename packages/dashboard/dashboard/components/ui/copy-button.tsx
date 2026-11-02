import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip.js'

// A small copy-to-clipboard affordance (#948) for the strings users take to a terminal:
// branch names, session ids, URLs. Flashes a check for a beat so the click visibly landed.
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  const Icon = copied ? Check : Copy
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={copy}
            aria-label={label}
            className={cn(
              'inline-flex shrink-0 items-center rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground',
              copied && 'text-success',
              className,
            )}
          />
        }
      >
        <Icon className="h-3 w-3" aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : label}</TooltipContent>
    </Tooltip>
  )
}
