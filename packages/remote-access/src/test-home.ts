import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A home folder of a test's own: the env the door's file is found through, and how to remove it. */
export async function testHome(): Promise<{ env: NodeJS.ProcessEnv; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'remote-access-'))
  return { env: { XDG_CONFIG_HOME: dir }, remove: () => rm(dir, { recursive: true, force: true }) }
}
