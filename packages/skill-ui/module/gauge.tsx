import { cn } from './utils.js'

/** A small ring, filled as far as the share in use, the share inside it, its name under it; amber near full, red at it. With no share known it is empty, with a dash: no number it cannot back. */
export function GaugeFace({ label, share }: { label: string; share: number | undefined }) {
  const r = 12
  const around = 2 * Math.PI * r
  // Whole class names, as the stylesheet's build finds them in the source.
  const tone = share === undefined ? { ring: '', text: 'text-muted-foreground' } : share >= 95 ? { ring: 'stroke-danger', text: 'text-danger' } : share >= 80 ? { ring: 'stroke-warning', text: 'text-warning' } : { ring: 'stroke-success', text: 'text-foreground' }
  return (
    <>
      <span className="relative size-8">
        <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
          <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" className="stroke-muted-foreground/15" />
          {share !== undefined && <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(around * Math.min(share, 100)) / 100} ${around}`} transform="rotate(-90 16 16)" className={cn('transition-[stroke-dasharray] duration-500', tone.ring)} />}
        </svg>
        <span className={cn('absolute inset-0 flex items-center justify-center text-[9px] font-medium tabular-nums', tone.text)}>{share ?? '–'}</span>
      </span>
      <span className="text-[9px] leading-tight text-muted-foreground">{label}</span>
    </>
  )
}
