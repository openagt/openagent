// What the tests of the door's process start in its place, and how they wait on it.
import { strict as assert } from 'node:assert'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Wait until `read` answers something; fails after five seconds. */
export async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const value = await read().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() > deadline) assert.fail('it never happened')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A door that writes down how it was started, then runs until told to end. */
export async function fakeDoor(dir: string, body = 'setInterval(() => {}, 1000)'): Promise<string> {
  const bin = join(dir, 'door.mjs')
  await writeFile(
    bin,
    `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(join(dir, 'started'))}, JSON.stringify({ pid: process.pid, args: process.argv.slice(2), url: process.env.OPENAGENT_URL, computer: process.env.OPENAGENT_COMPUTER, home: process.env.XDG_CONFIG_HOME }) + '\\n')\nconsole.error('door: up')\n${body}\n`,
  )
  return bin
}

export interface DoorStart {
  pid: number
  args: string[]
  url: string
  computer?: string
  home?: string
}

export const starts = async (dir: string): Promise<DoorStart[]> =>
  (await readFile(join(dir, 'started'), 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as DoorStart)
