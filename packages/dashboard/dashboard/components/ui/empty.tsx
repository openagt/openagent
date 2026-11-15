import type { ReactNode } from 'react'

/** The logo's hexagon with nothing in it yet: a dashed outline around a faint core. */
function EmptyHex() {
  return (
    <svg viewBox="0 0 48 52" aria-hidden className="mx-auto mb-4 h-13 w-12 text-faint-foreground">
      <polygon points="24,2 45,14 45,38 24,50 3,38 3,14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 3" strokeLinejoin="round" />
      <polygon points="24,16 32,20.5 32,31.5 24,36 16,31.5 16,20.5" fill="currentColor" opacity={0.25} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeOpacity={0.25} />
    </svg>
  )
}

/** A part with nothing in it, said where its rows would stand: the empty hexagon, what is missing, why it fills, and what fills it. */
export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 pt-14 pb-12 text-center">
      <EmptyHex />
      <p className="text-base font-semibold">{title}</p>
      {children !== undefined && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action !== undefined && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}
