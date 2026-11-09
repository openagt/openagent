import { join } from 'node:path'
import { GIT_FAILED, Refused, UsageError, checkoutRoot, inRepo, listProjectDir, nodeBranchFileFs, nodeGitRunner, openProjectReader, parseCommandArgs, readProjectFile, runCommandLine, writeProjectDataDetached, type Command, type ProjectReader, type GitRunner } from '@openagt/agent-data'
import { isTicketFile, isTicketPath, META_FILE, TICKETS_DIR, ticketLockName, ticketPlanName, ticketStem } from './names.js'
import { readTicket, readTickets, readTicketsMeta, type TicketsFs } from './tickets.js'
import { applyClaims, applyRelease, claimHistory, claimMessage, lockHolder, releaseMessage } from './locks.js'
import { holderOf } from './holder.js'

/**
 * The command line over the package: the same operations a daemon calls, for an agent (and a
 * person) in a shell, in any clone of the repository. It answers as every OpenAgent command does
 * (`runCommandLine`); a refusal here is a rule saying no: the ticket is someone else's, there is
 * no such ticket.
 *
 * A project kept on this machine reads and writes its directory in the personal folder, one
 * commit per write. A shared project reads origin's copy of its branch, fetched first, so a
 * command sees what every writer pushed — its own earlier writes included — and writes as a
 * remote writer: one commit each, on a throwaway checkout of origin's tip, pushed straight to the
 * branch; a rejected push is re-applied on the new tip and pushed again. The persistent checkout
 * a daemon keeps is never touched.
 *
 * Two flags are the dashboard's, never an agent's: `--local` on the reads (this machine's copy, no
 * fetch — the dashboard polls, and the writer on that machine keeps it synced), and `--force` on `release` (lift whoever's claim: a person's answer to a dead agent).
 * OpenAgent finds this command through the package's `openagent.tickets` declaration.
 */

export const USAGE = `usage: tickets <command>

  list [--local]                     every open ticket, as one JSON array
  show <file> [--local]              one ticket: its text, its plan, who holds it
  meta [--local]                     when the tickets last caught up with the issue tracker
  put <file>                         write one file under tickets/ from stdin (a ticket, a plan, meta.json)
  close <file>                       remove a ticket with its plan and lock (not while someone else holds it)
  claim <file>                       claim a ticket before planning or working it; names who claimed it before
  release <file> [--force]           lift your own claim; --force lifts anyone's (a person's act)

JSON on stdout. Exit code 1 for a refusal or a git failure (the reason on stderr), 2 for a usage error.`

/** The streams and the working directory a run of the CLI sees. */
export interface CliIo {
  cwd: string
  /** Everything on standard input, for `put`. */
  stdin: () => Promise<string>
  stdout: (line: string) => void
  stderr: (line: string) => void
}

/** Run the CLI: `argv` is everything after the program name. Resolves to the exit code. */
export function runCli(argv: string[], io: CliIo, git: GitRunner = nodeGitRunner()): Promise<number> {
  return runCommandLine(argv, io, { usage: USAGE, commands: COMMANDS, failure: GIT_FAILED }, io, git)
}

const COMMANDS: Record<string, Command<[CliIo, GitRunner]>> = {
  async list(args, io, git) {
    const { values } = parseCommandArgs(args, LOCAL, 0)
    return readTickets(TICKETS_DIR, await ticketsFs(io.cwd, values.local, git))
  },

  async meta(args, io, git) {
    const { values } = parseCommandArgs(args, LOCAL, 0)
    return readTicketsMeta(TICKETS_DIR, await ticketsFs(io.cwd, values.local, git))
  },

  async show(args, io, git) {
    const { positionals, values } = parseCommandArgs(args, LOCAL, 1)
    const file = ticketArg(positionals[0]!)
    const fs = await ticketsFs(io.cwd, values.local, git)
    const ticket = await readTicket(TICKETS_DIR, file, fs)
    if (!ticket) throw noTicket(file)
    const plan = await fs.read(`${TICKETS_DIR}/${ticketPlanName(file)}`)
    return { ok: true, ticket, ...(plan === undefined ? {} : { plan }), ...(ticket.lockedBy === undefined ? {} : { holder: ticket.lockedBy }) }
  },

  async put(args, io, git) {
    const { positionals } = parseCommandArgs(args, {}, 1)
    // The bare filename, or the `tickets/<file>` path a queue entry links to, like every other command.
    const file = positionals[0]!.startsWith(`${TICKETS_DIR}/`) ? positionals[0]!.slice(TICKETS_DIR.length + 1) : positionals[0]!
    // A ticket, its plan, or the meta file — never a lock: claims go through `claim`.
    if (!(isTicketFile(file) || (isTicketFile(file.replace(/\.plan\.md$/, '.md')) && file.endsWith('.plan.md')) || file === META_FILE))
      throw new Refused({ ok: false, reason: 'invalid-path', file }, `${file} is not a file under ${TICKETS_DIR}/ this command writes: a ticket, its .plan.md, or ${META_FILE}`)
    const content = await io.stdin()
    await write(io.cwd, `put ${TICKETS_DIR}/${file}`, async dir => {
      await nodeBranchFileFs().write(join(dir, TICKETS_DIR, file), content)
    }, git)
    return { ok: true, file: `${TICKETS_DIR}/${file}` }
  },

  async close(args, io, git) {
    const { positionals } = parseCommandArgs(args, {}, 1)
    const file = ticketArg(positionals[0]!)
    const holder = await identity(io.cwd, git)
    type CloseOutcome = { ok: true } | { ok: false; reason: 'no-ticket' } | { ok: false; reason: 'not-holder'; holder?: string }
    let outcome = { ok: true } as CloseOutcome
    await write(io.cwd, `close ${TICKETS_DIR}/${ticketStem(file)}`, async dir => {
      const fs = nodeBranchFileFs()
      if (!(await fs.read(join(dir, TICKETS_DIR, file)).then(() => true, () => false))) {
        outcome = { ok: false, reason: 'no-ticket' }
        return
      }
      // Someone else's claim outranks the close: closing takes their lock with the ticket.
      const lock = await fs.read(join(dir, TICKETS_DIR, ticketLockName(file))).catch(() => undefined)
      const other = lock === undefined ? undefined : lockHolder(lock)
      if (lock !== undefined && other !== holder) {
        outcome = { ok: false, reason: 'not-holder', ...(other === undefined ? {} : { holder: other }) }
        return
      }
      outcome = { ok: true }
      for (const name of [file, ticketPlanName(file), ticketLockName(file)]) await fs.remove(join(dir, TICKETS_DIR, name)).catch(() => {})
    }, git)
    if (!outcome.ok) {
      if (outcome.reason === 'no-ticket') throw noTicket(file)
      throw new Refused({ ...outcome, file }, `${TICKETS_DIR}/${file} is claimed by ${outcome.holder ?? 'someone else'}, not by you`)
    }
    return { ok: true, file: `${TICKETS_DIR}/${file}` }
  },

  async claim(args, io, git) {
    const { positionals } = parseCommandArgs(args, {}, 1)
    const file = ticketArg(positionals[0]!)
    const holder = await identity(io.cwd, git)
    type ClaimOutcome = { ok: true; earlier: string[] } | { ok: false; reason: 'no-ticket' } | { ok: false; reason: 'claimed'; holder?: string }
    // Assigned inside the op, which a lost race re-runs: typed wide so the read below sees every case.
    let outcome = { ok: true, earlier: [] } as ClaimOutcome
    await write(io.cwd, claimMessage([{ ticket: file, holder }]), async dir => {
      const fs = nodeBranchFileFs()
      if (!(await fs.read(join(dir, TICKETS_DIR, file)).then(() => true, () => false))) {
        outcome = { ok: false, reason: 'no-ticket' }
        return
      }
      // A claim to plan or to work: an existing plan is not in the way, only someone's lock is.
      const locked = await applyClaims(dir, [{ ticket: file, holder }], 'drain', fs)
      if (locked.length) {
        // Who claimed it before, read off the lock's history at origin's tip: this claim is not
        // committed yet, so every holder there is an earlier one, bar this holder claiming again.
        const patch = await git(['log', '-p', '--format=', '--no-renames', '--', `${TICKETS_DIR}/${ticketLockName(file)}`], dir)
        outcome = { ok: true, earlier: claimHistory(patch).filter(h => h !== holder) }
        return
      }
      // The holder as the lock names it; a lock that names nobody readable is still a claim.
      const existing = lockHolder((await fs.read(join(dir, TICKETS_DIR, ticketLockName(file))).catch(() => '')) ?? '')
      outcome = { ok: false, reason: 'claimed', ...(existing === undefined ? {} : { holder: existing }) }
    }, git)
    if (!outcome.ok) {
      if (outcome.reason === 'no-ticket') throw noTicket(file)
      throw new Refused({ ...outcome, file }, `${TICKETS_DIR}/${file} is claimed by ${outcome.holder ?? 'someone else'}: pick another ticket`)
    }
    return { ok: true, file: `${TICKETS_DIR}/${file}`, holder, earlier: outcome.earlier }
  },

  async release(args, io, git) {
    const { positionals, values } = parseCommandArgs(args, { force: { type: 'boolean' } }, 1)
    const file = ticketArg(positionals[0]!)
    // `--force` lifts whoever's claim, so it needs no identity of its own: a person's act, from
    // the dashboard, on a claim nobody answers to any more.
    const holder = values.force ? undefined : await identity(io.cwd, git)
    let outcome = 'released' as 'released' | 'no-lock' | 'not-holder'
    let other: string | undefined
    await write(io.cwd, releaseMessage(file), async dir => {
      const fs = nodeBranchFileFs()
      outcome = await applyRelease(dir, file, holder, fs)
      if (outcome === 'not-holder') other = lockHolder((await fs.read(join(dir, TICKETS_DIR, ticketLockName(file))).catch(() => '')) ?? '')
    }, git)
    if (outcome === 'no-lock') throw new Refused({ ok: false, reason: 'no-lock', file }, `${TICKETS_DIR}/${file} is not claimed`)
    if (outcome === 'not-holder') throw new Refused({ ok: false, reason: 'not-holder', file, holder: other }, `${TICKETS_DIR}/${file} is claimed by ${other ?? 'someone else'}, not by you`)
    return { ok: true, file: `${TICKETS_DIR}/${file}`, ...(holder === undefined ? {} : { holder }) }
  },
}

/** The one flag every read takes. */
const LOCAL = { local: { type: 'boolean' } } as const

/** The project's data opened for reading, from wherever the command runs; outside a repo, a refusal. */
async function open(cwd: string, git: GitRunner): Promise<ProjectReader> {
  await inRepo(() => checkoutRoot(cwd, git))
  return openProjectReader(cwd, { git })
}

/**
 * The ticket reader a read goes through, paths relative to the project's data (`tickets/<file>`):
 * see {@link open}, or with `--local` this machine's copy with no fetch, for the dashboard's polling.
 */
async function ticketsFs(cwd: string, local: boolean | undefined, git: GitRunner): Promise<TicketsFs> {
  if (!local) {
    const reader = await open(cwd, git)
    return { list: dir => reader.list(dir), read: path => reader.read(path) }
  }
  await inRepo(() => checkoutRoot(cwd, git))
  return { list: dir => listProjectDir(cwd, dir, {}, { git }), read: path => readProjectFile(cwd, path, {}, { git }) }
}

/** One write as a one-shot writer: to origin when the project is shared, else as a local commit. */
async function write(cwd: string, message: string, op: (dir: string) => Promise<void>, git: GitRunner): Promise<void> {
  await inRepo(() => checkoutRoot(cwd, git))
  await writeProjectDataDetached(cwd, message, op, { git })
}

/** Who this command claims as; a checkout on no branch has no identity to claim with. */
async function identity(cwd: string, git: GitRunner): Promise<string> {
  const holder = await inRepo(() => holderOf(cwd, git))
  if (!holder.ok) throw new Refused({ ok: false, reason: holder.reason }, 'this checkout is on no branch, so there is nothing to claim as')
  return holder.holder
}

function noTicket(file: string): Refused {
  return new Refused({ ok: false, reason: 'no-ticket', file }, `no ticket ${TICKETS_DIR}/${file}`)
}

/** A ticket named by its bare filename, or by its `tickets/<file>` path. */
function ticketArg(arg: string): string {
  const file = isTicketPath(arg) ? arg.slice(TICKETS_DIR.length + 1) : arg
  if (!isTicketFile(file)) throw new Refused({ ok: false, reason: 'invalid-path', file: arg }, `${arg} is not a ticket filename`)
  return file
}
