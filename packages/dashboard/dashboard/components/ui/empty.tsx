import type { ReactNode } from 'react'

/** A part with nothing in it, said where its rows would stand: what is missing, why it fills, and what fills it. */
export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children !== undefined && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action !== undefined && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}
