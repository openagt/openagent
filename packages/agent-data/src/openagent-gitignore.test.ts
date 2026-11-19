import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { openagentGitignore } from './openagent-gitignore.js'

test('against real git: everything under .openagent is hidden from git, the ignore file included (#1582)', async () => {
  // The lasting records live on the data branch, so the ignore file is "ignore it all" — a
  // session's live state, the transient archive, and the run checkouts must never dirty main.
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { execFileSync } = await import('node:child_process')

  const repo = await mkdtemp(join(tmpdir(), 'oa-sessions-'))
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  try {
    git('init', '-q')
    git('config', 'user.email', 'git@example.com')
    git('config', 'user.name', 'Test')

    const fw = join(repo, '.openagent')
    await mkdir(join(fw, 'branches', 'agent-r9'), { recursive: true })
    await writeFile(join(fw, '.gitignore'), openagentGitignore())
    await writeFile(join(fw, 'r9.json'), '{}\n')
    await writeFile(join(fw, 'r9.jsonl'), '\n')
    await writeFile(join(fw, 'branches', 'agent-r9', 'file.txt'), 'x\n')

    const status = git('status', '--porcelain', '-uall')
    assert.equal(status, '', 'a run\'s card and diary, a directory under it and the ignore file itself: git shows no trace of any')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
