import { originGit } from '../dashboard-rpc/send-as.js'

/** How long a read of origin's branches waits: past this, origin counts as not reached. */
const ORIGIN_WAIT_MS = 10_000

/**
 * The branches origin has now, asked of origin itself: this clone's copies keep every branch it
 * ever saw, long after origin deleted it. Nothing where origin could not be read.
 */
export async function branchesOnOrigin(cwd: string): Promise<string[] | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), ORIGIN_WAIT_MS)
    timer.unref()
  })
  // Asked as one of OpenAgent's accounts, never the person's own login.
  const listed = originGit(cwd).then(git => git(['ls-remote', '--heads', 'origin'], cwd)).catch(() => undefined)
  const out = await Promise.race([listed, late])
  clearTimeout(timer)
  if (out === undefined) return undefined
  return out.split('\n').flatMap(line => line.match(/\trefs\/heads\/(.+)$/)?.[1] ?? [])
}
