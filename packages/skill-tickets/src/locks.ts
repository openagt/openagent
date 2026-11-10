import { join } from 'node:path'
import { TICKETS_DIR, ticketLockName, ticketPlanName, ticketStem } from './names.js'
import { resolveTicketDeps, type TicketDeps, type TicketFiles } from './store.js'

// The `.lock.md` claim on a ticket: a ticket is worked or planned by one holder at a time, and the
// guard cannot be anyone's memory — the holder may be on another machine, or a cloud session whose
// local process is gone. So the claim is a file beside the ticket, `tickets/<STEM>.lock.md`,
// holding one line, `CLAIMED: <holder>`, on the `agent-data` branch where every reader already looks.
//
// There is no timed release: a holder can legitimately keep a ticket for days, and a lock lifted
// under a live holder re-opens the exact double-work window it exists to close. The lock lifts
// when the ticket is closed with its siblings, when its holder releases it, when a person releases
// it by hand, or when a caller frees a claim it made for a holder it knows ended with nothing.

/** The first line of a lock file: the claim, naming who holds the ticket. */
const LOCK_PREFIX = 'CLAIMED:'

/** What a lock file holds: the claim line and nothing else. */
export function lockContent(holder: string): string {
  return `${LOCK_PREFIX} ${holder}\n`
}

/** The holder a lock file names, or `undefined` for content that is not a claim line. */
export function lockHolder(md: string): string | undefined {
  const line = md.trimStart()
  if (!line.startsWith(LOCK_PREFIX)) return undefined
  const holder = line.slice(LOCK_PREFIX.length).split('\n', 1)[0]!.trim()
  return holder || undefined
}

/** Where a ticket's lock sits in a checkout of the branch. */
function lockPath(dir: string, ticket: string): string {
  return join(dir, TICKETS_DIR, ticketLockName(ticket))
}

/**
 * The claim on a ticket in a checkout of the branch: `undefined` when it has no lock, else the
 * holder the lock names — `undefined` too when it names nobody readable, and the lock stands all
 * the same: its existence is the claim.
 */
export async function lockOn(dir: string, ticket: string, files: Pick<TicketFiles, 'read'>): Promise<{ holder: string | undefined } | undefined> {
  const md = await files.read(lockPath(dir, ticket)).catch(() => undefined)
  return md === undefined ? undefined : { holder: lockHolder(md) }
}

/**
 * The holders a lock file's history named, newest first, each once: the claim lines its commits
 * added, read from `git log -p` of the lock. A released claim leaves the file but not the history,
 * so this is who worked or planned the ticket before, however their claim ended.
 */
export function claimHistory(patch: string): string[] {
  const holders: string[] = []
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    const holder = lockHolder(line.slice(1))
    if (holder !== undefined && !holders.includes(holder)) holders.push(holder)
  }
  return holders
}

/** One claim: the ticket's filename inside `tickets/`, and who holds it. */
export interface TicketClaim {
  ticket: string
  holder: string
}

/**
 * Which side of a ticket's life a batch claims for. A `plan` batch is about to *write* plans, so
 * an existing `.plan.md` means the work it came for is already done and the ticket is skipped. A
 * `drain` batch is about to *implement* a plan — the `.plan.md` is its input, not a competing
 * claim — so only an existing `.lock.md` stands in its way.
 */
export type ClaimPhase = 'plan' | 'drain'

/**
 * The claim applied to a directory of tickets: one lock per claim, an existing file outranking
 * the batch. Resolves the subset actually locked. Re-runnable — a pure function of the directory
 * it is handed — so a writer that re-applies the intent after a lost race re-judges the batch
 * instead of double-claiming: an existing lock naming this very holder is the batch's own claim
 * seen again, and still counts as locked.
 */
export async function applyClaims(dir: string, claims: readonly TicketClaim[], phase: ClaimPhase, files: TicketFiles): Promise<TicketClaim[]> {
  const locked: TicketClaim[] = []
  for (const claim of claims) {
    const lock = await lockOn(dir, claim.ticket, files)
    if (lock) {
      if (lock.holder === claim.holder) locked.push(claim)
      continue
    }
    if (phase === 'plan' && (await files.read(join(dir, TICKETS_DIR, ticketPlanName(claim.ticket))).then(() => true, () => false))) continue
    await files.write(lockPath(dir, claim.ticket), lockContent(claim.holder))
    locked.push(claim)
  }
  return locked
}

/** The commit a batch of claims lands as, naming the count. */
export function claimMessage(claims: readonly TicketClaim[]): string {
  return claims.length === 1 ? `claim ${TICKETS_DIR}/${ticketStem(claims[0]!.ticket)}` : `claim ${claims.length} tickets`
}

/**
 * Claim `claims`' tickets for their holders through the caller's funnel, as one commit, pushed.
 * Resolves the subset actually locked. A batch that could not land at all resolves `[]` and logs
 * why — otherwise "no claims" is indistinguishable from "lost every race". A batch that committed
 * but could not *push* is kept and resolved as locked: the commit still guards every reader of
 * this machine's checkout, and the cross-machine gap is logged rather than treated as failure.
 * Never throws.
 */
export async function claimTickets(root: string, claims: readonly TicketClaim[], phase: ClaimPhase, deps: TicketDeps = {}): Promise<TicketClaim[]> {
  const r = resolveTicketDeps(deps)
  let locked: TicketClaim[] = []
  const result = await r.funnel(
    root,
    () => claimMessage(locked),
    async dir => {
      locked = await applyClaims(dir, claims, phase, r)
    },
  )
  if (!result.ok && !result.committed) {
    r.log(`[tickets] the claims could not be committed (${result.error})`)
    return []
  }
  if (!result.ok) r.log(`[tickets] the claims could not be pushed, so other machines cannot see these ${locked.length} claim(s)`)
  return locked
}

/** What a release did: freed the ticket, found nothing to free, or found someone else's claim. */
export type ReleaseOutcome = 'released' | 'no-lock' | 'not-holder'

/**
 * The release applied to a directory of tickets. With `heldBy`, the lock is freed only while it
 * still names that holder — a lock naming anyone else is someone's live claim and outranks the
 * release; without it, whoever holds the lock is released.
 */
export async function applyRelease(dir: string, ticket: string, heldBy: string | undefined, files: TicketFiles): Promise<ReleaseOutcome> {
  const lock = await lockOn(dir, ticket, files)
  if (!lock) return 'no-lock'
  if (heldBy !== undefined && lock.holder !== heldBy) return 'not-holder'
  await files.remove(lockPath(dir, ticket))
  return 'released'
}

/** The commit a release lands as. */
export function releaseMessage(ticket: string): string {
  return `release ${TICKETS_DIR}/${ticketStem(ticket)}`
}

/**
 * Free one ticket's lock through the caller's funnel. `heldBy` frees only the exact claim it
 * names (a caller cleaning up after a holder it knows ended with nothing); absent, whoever holds
 * the lock is released. A release that cannot land reports `error` and changes nothing — the
 * funnel restores the checkout, so the committed state keeps telling the truth about the claim.
 */
export async function releaseTicket(root: string, ticket: string, opts: { heldBy?: string } = {}, deps: TicketDeps = {}): Promise<ReleaseOutcome | 'error'> {
  const r = resolveTicketDeps(deps)
  let outcome: ReleaseOutcome = 'released'
  const result = await r.funnel(root, releaseMessage(ticket), async dir => {
    outcome = await applyRelease(dir, ticket, opts.heldBy, r)
  })
  if (!result.ok && !result.committed) return 'error'
  if (!result.ok) r.log(`[tickets] the release of ${ticket} could not be pushed`)
  return outcome
}
