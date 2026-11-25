import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPackageCommand } from './package-command.js'

// A package's command run in a project, against real files: a throwaway folder holding a package
// under node_modules, as a caller (a distribution) has it.

const ECHO = `process.stdout.write(JSON.stringify(process.argv.slice(2)))`

/** A folder holding `deps`, each installed under node_modules with a command that says what it was given. */
async function project(deps: Record<string, Record<string, unknown>>): Promise<{ root: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'package-command-')))
  for (const [name, fields] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...fields }))
    await writeFile(join(dir, 'cmd.cjs'), ECHO)
  }
  return { root }
}

test('a package command runs with Node in the project and answers its JSON, its last stderr line, what a wrong command line was told first, or that it printed none', async () => {
  const { root } = await project({ tool: { bin: { tool: 'cmd.cjs' } } })
  const dir = join(root, 'node_modules', 'tool')
  await writeFile(join(dir, 'fails.cjs'), `process.stderr.write('first\\nno such thing\\n'); process.exit(1)`)
  await writeFile(join(dir, 'usage.cjs'), `process.stderr.write('no such option\\n\\nusage: tool\\nthe usage ends here\\n'); process.exit(2)`)
  await writeFile(join(dir, 'text.cjs'), `process.stdout.write('hello')`)
  await writeFile(join(dir, 'cwd.cjs'), `process.stdout.write(JSON.stringify(process.cwd()))`)
  try {
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'cmd.cjs') }, ['list', '--all']), { ok: true, output: ['list', '--all'] })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'fails.cjs') }, []), { ok: false, error: 'no such thing' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'usage.cjs') }, []), { ok: false, error: 'no such option' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'text.cjs') }, []), { ok: false, error: 'tool printed no JSON' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'cwd.cjs') }, []), { ok: true, output: await realpath(root) })
    // What a caller adds is what the command is started with, beside what this process has, and for that command alone.
    await writeFile(join(dir, 'said.cjs'), `process.stdout.write(JSON.stringify([process.env.OPENAGENT_TEST_SAID ?? null, typeof process.env.PATH]))`)
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'said.cjs') }, [], { OPENAGENT_TEST_SAID: 'a word' }), { ok: true, output: ['a word', 'string'] })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'said.cjs') }, []), { ok: true, output: [null, 'string'] })
    assert.equal(process.env.OPENAGENT_TEST_SAID, undefined)
    // What it is handed it reads on standard input; a command handed nothing reads an input that ended, and waits for nothing.
    await writeFile(join(dir, 'read.cjs'), `let s = ''; process.stdin.on('data', d => (s += d)).on('end', () => process.stdout.write(JSON.stringify(s)))`)
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'read.cjs') }, [], undefined, 'a login'), { ok: true, output: 'a login' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'read.cjs') }, []), { ok: true, output: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
