import { useState } from 'react'
import { cn } from '../lib/utils.js'

// A person's round mark, wherever a person is shown beside what they did: their picture from the
// git host, else two letters of their name. The letters are there first, and stay until the picture
// has landed, so the mark holds its place and never shows an empty circle or a broken image. Its
// fill stays seen on a row's hover, whose own fill is the muted colour in the dark theme.

/** An email name that says nothing of whose it is: the domain names them instead. */
const GENERIC = new Set(['git', 'me', 'mail', 'email', 'hello', 'hi', 'info', 'contact', 'dev', 'noreply', 'no-reply'])

/**
 * The name a person goes by here: the one git knows them by, else one drawn from their email
 * (`suleiman@averotech.com` is suleiman), or from its domain when its name is a generic word
 * (`git@brillout.com` is brillout).
 */
export function personName(email: string, name?: string): string {
  const known = name?.trim()
  if (known) return known
  const [own = '', domain = ''] = email.split('@')
  if (GENERIC.has(own.toLowerCase()) && domain) return domain.split('.')[0] || email
  return own || email
}

/** Two letters for a person's mark: "Romuald Brillout" is RB, "suleiman" is SU. */
export function personLetters(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  return (parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : name.slice(0, 2)).toUpperCase()
}

/**
 * A person's mark. No email: an empty circle, for a row whose person is seconds away. `said` is
 * what it says when pointed at and to a reader that cannot see it; without it, it is decoration
 * and whatever is around it says who. `you` sets the person at this computer apart.
 */
export function PersonMark({ email, name, picture, you = false, said, className }: { email?: string | undefined; name?: string | undefined; picture?: string | undefined; you?: boolean | undefined; said?: string | undefined; className?: string | undefined }) {
  // How the picture last went, by its address: a person's next picture gets its own chance.
  const [settled, setSettled] = useState<{ picture: string; landed: boolean } | undefined>()
  const went = settled?.picture === picture ? settled : undefined
  return (
    <span
      {...(said ? { role: 'img', 'aria-label': said, title: said } : { 'aria-hidden': true })}
      className={cn('relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold', you ? 'bg-primary/15 text-primary' : 'bg-muted-foreground/15 text-muted-foreground', you && went?.landed && 'ring-2 ring-primary/40', className)}
    >
      {email && !went?.landed && personLetters(personName(email, name))}
      {picture && went?.landed !== false && <img src={picture} alt="" referrerPolicy="no-referrer" onLoad={() => setSettled({ picture, landed: true })} onError={() => setSettled({ picture, landed: false })} className="absolute inset-0 size-full object-cover" />}
    </span>
  )
}
