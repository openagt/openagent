import type { GitRunner } from '@openagt/hooks'

/** How long a read of origin's branches waits: past this, origin counts as not reached. */
const ORIGIN_WAIT_MS = 10_000

/**
 * The branches origin has now, asked of origin itself: this clone's copies keep every branch it
 * ever saw, long after origin deleted it. `git` is how origin is reached, as one of OpenAgent's
 * accounts, never the person's own login. Nothing where origin could not be read.
 */
export async function branchesOnOrigin(cwd: string, git: GitRunner): Promise<string[] | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), ORIGIN_WAIT_MS)
    timer.unref()
  })
  const listed = git(['ls-remote', '--heads', 'origin'], cwd).catch(() => undefined)
  const out = await Promise.race([listed, late])
  clearTimeout(timer)
  if (out === undefined) return undefined
  return out.split('\n').flatMap(line => line.match(/\trefs\/heads\/(.+)$/)?.[1] ?? [])
}
