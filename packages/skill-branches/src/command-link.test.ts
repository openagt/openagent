import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { nodeGitRunner } from '@openagt/agent-data'
import { CLI_BIN_DIR } from './bin-dir.js'
import { createCheckout, relinkCheckout } from './checkout.js'

const git = nodeGitRunner()
const run = promisify(execFile)
const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false)

async function repoWithOneCommit(files: Record<string, string> = {}): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'command-link-')))
  await git(['init', '-q', '-b', 'main'], repo)
  await writeFile(join(repo, 'README.md'), 'hi\n')
  for (const [name, text] of Object.entries(files)) await writeFile(join(repo, name), text)
  await git(['add', '-A'], repo)
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], repo)
  return repo
}

test('a checkout in a project with nothing installed holds the command, hidden from git, and it is the one that runs', async () => {
  const repo = await repoWithOneCommit()
  try {
    const { path } = await createCheckout(repo, { agentId: 'a1' })
    const link = join(path, 'node_modules', '.bin', 'branches')
    assert.equal(await realpath(link), await realpath(join(CLI_BIN_DIR, 'branches')))
    assert.equal((await git(['status', '--porcelain'], path)).trim(), '', 'the link is not the agent\'s work: nothing to commit')
    // The command found in the checkout is this package's: it answers the checkout's own status.
    const { stdout } = await run(link, ['status'], { cwd: path })
    assert.equal(JSON.parse(stdout).path, path)
    // The package is there too, so the skill's full name finds this copy: `npx` asks npm for nothing.
    const pkg = join(path, 'node_modules', '@openagt', 'skill-branches')
    assert.equal(await realpath(pkg), await realpath(join(CLI_BIN_DIR, '..')))
    const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'))
    assert.equal(manifest.name, '@openagt/skill-branches')
    // The range the skill's text names: a copy outside it would send `npx` to npm.
    assert.match(manifest.version, /^0\.1\.\d+$/)
    assert.match(await readFile(join(pkg, 'SKILL.md'), 'utf8'), /npx @openagt\/skill-branches@0\.1 status/)
    // `npx` itself, kept off the network: with the full name it finds this copy and runs it.
    const viaNpx = await run('npx', ['--offline', '--yes', '@openagt/skill-branches@0.1', 'status'], { cwd: path })
    assert.equal(JSON.parse(viaNpx.stdout).path, path)
    // Linking again changes nothing.
    await relinkCheckout(repo, path)
    assert.equal(await realpath(link), await realpath(join(CLI_BIN_DIR, 'branches')))
    assert.equal(await realpath(pkg), await realpath(join(CLI_BIN_DIR, '..')))
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test("a project that installed its own copy keeps it: the checkout's command is the project's", async () => {
  const repo = await repoWithOneCommit({ '.gitignore': 'node_modules/\n' })
  try {
    await mkdir(join(repo, 'node_modules', '.bin'), { recursive: true })
    await writeFile(join(repo, 'node_modules', '.bin', 'branches'), '#!/bin/sh\necho own\n', { mode: 0o755 })
    const { path } = await createCheckout(repo, { agentId: 'a2' })
    const { stdout } = await run(join(path, 'node_modules', '.bin', 'branches'), [], { cwd: path })
    assert.equal(stdout.trim(), 'own')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test("a project that installed its own copy of the package keeps it: the checkout's package is the project's", async () => {
  const repo = await repoWithOneCommit({ '.gitignore': 'node_modules/\n' })
  try {
    const own = join(repo, 'node_modules', '@openagt', 'skill-branches')
    await mkdir(own, { recursive: true })
    await writeFile(join(own, 'package.json'), '{"name":"@openagt/skill-branches","version":"9.9.9"}\n')
    const { path } = await createCheckout(repo, { agentId: 'a3' })
    const pkg = join(path, 'node_modules', '@openagt', 'skill-branches')
    assert.equal(await realpath(pkg), await realpath(own))
    // Linking again leaves the project's copy where it is.
    await relinkCheckout(repo, path)
    assert.equal(await realpath(pkg), await realpath(own))
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('beside another tool that holds the command\'s name the package is not linked: the full name is left to npm', async () => {
  const repo = await repoWithOneCommit({ '.gitignore': 'node_modules/\n' })
  try {
    await mkdir(join(repo, 'node_modules', '.bin'), { recursive: true })
    await writeFile(join(repo, 'node_modules', '.bin', 'branches'), '#!/bin/sh\necho another tool\n', { mode: 0o755 })
    const { path } = await createCheckout(repo, { agentId: 'a4' })
    const { stdout } = await run(join(path, 'node_modules', '.bin', 'branches'), [], { cwd: path })
    assert.equal(stdout.trim(), 'another tool')
    // With the package linked, `npx @openagt/skill-branches@0.1` would run that other tool.
    assert.equal(await exists(join(path, 'node_modules', '@openagt', 'skill-branches')), false)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a second checkout of a project with tools of its own gets the package too: the command the first one linked is this package\'s', async () => {
  const repo = await repoWithOneCommit({ '.gitignore': 'node_modules/\n' })
  try {
    // The project's `.bin` is linked whole into a checkout, so the first checkout's command link lands in it.
    await mkdir(join(repo, 'node_modules', '.bin'), { recursive: true })
    await createCheckout(repo, { agentId: 'a5' })
    const { path } = await createCheckout(repo, { agentId: 'a6' })
    assert.equal(await realpath(join(path, 'node_modules', '.bin', 'branches')), await realpath(join(CLI_BIN_DIR, 'branches')))
    assert.equal(await realpath(join(path, 'node_modules', '@openagt', 'skill-branches')), await realpath(join(CLI_BIN_DIR, '..')))
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
