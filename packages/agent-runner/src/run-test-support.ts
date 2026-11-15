// What the run tests share: a fixed clock, fake git hosts and the fake agents a run is started with.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeDriver, promptSent, type Driver, type DriverSession, type DriverStartOptions, type FakeDriverSession } from '@openagt/agent-driver'
import type { GitHost } from './git-host.js'
import { git } from './test-repo.js'

export const NOW = new Date('2026-09-16T14:01:00.000Z')

/** A git host with no pull request for any branch: what a run whose agent opened none reads. */
export const noGitHost: GitHost = { requestOfBranch: async () => undefined }

/**
 * A git host holding one pull request for one branch, once the agent has opened it (`open()`): read
 * back by the run. Every call is kept.
 */
export function fakeGitHost(branch: string, hook?: () => Promise<void>): GitHost & { open(): void; calls: string[][] } {
  let opened = false
  const calls: string[][] = []
  return {
    calls,
    open: () => (opened = true),
    requestOfBranch: async (_repo, asked) => {
      calls.push(['requests', asked])
      await hook?.()
      return opened && asked === branch ? { number: 12, url: 'https://example.com/x/y/pull/12' } : undefined
    },
  }
}

/** A fake session with something done before each prompt, handed the prompt as the agent is sent it, the attached text and the added sentence after it: the spread of a class instance loses its methods, so the wrapper is explicit. */
export function wrap(fake: FakeDriverSession, before: (text: string) => Promise<void>): DriverSession & { prompts: string[] } {
  return {
    id: fake.id,
    cwd: fake.cwd,
    prompts: fake.prompts,
    ...(fake.log ? { log: fake.log } : {}),
    prompt: async (text, opts) => {
      await before(promptSent(text, opts ?? {}))
      return fake.prompt(text, opts)
    },
    dispose: () => fake.dispose(),
  }
}

export const QUESTION = 'Plan written.\n\n```await-choices\n{ "title": "Ship it?", "options": [{ "label": "Approve" }, { "label": "Decline", "stop": true }], "recommended": "Approve" }\n```\n'

/** An agent that commits one file on a branch it names itself, the way a real one does. */
export function committingDriver(): Driver {
  return {
    id: 'fake',
    start: async (opts: DriverStartOptions): Promise<DriverSession> => {
      const fake = await new FakeDriver({
        respond: () => ({ text: 'Fixed it and committed.', usage: { costUsd: 0.5, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 } }),
        sessionId: 's-1',
        model: 'claude-opus-5-5',
      }).start(opts)
      return wrap(fake, async () => {
        await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
        await git(['config', 'user.name', 'agent'], opts.cwd)
        await git(['branch', '-m', 'agent-fix-it'], opts.cwd)
        await writeFile(join(opts.cwd, 'fixed.txt'), 'fixed\n')
        await git(['add', '-A'], opts.cwd)
        await git(['commit', '-q', '-m', 'Fix it'], opts.cwd)
      })
    },
  }
}

/** A clock a minute on at every reading: two runs of one process get two ids. */
export function ticking(): () => Date {
  let minutes = 0
  return () => new Date(NOW.getTime() + minutes++ * 60_000)
}

/** An agent that commits a file on the branch it names, pushes it and opens its pull request, the way the skills say; it notes the prompt it was given. */
export function publishingDriver(gitHost: ReturnType<typeof fakeGitHost>, seen: { prompt?: string }): Driver {
  return {
    id: 'fake',
    start: async (opts: DriverStartOptions): Promise<DriverSession> => {
      const fake = await new FakeDriver({ turns: [{ text: 'Fixed it and published.' }], sessionId: 's-1' }).start(opts)
      return wrap(fake, async text => {
        seen.prompt = text
        await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
        await git(['config', 'user.name', 'agent'], opts.cwd)
        await git(['branch', '-m', 'agent-fix-it'], opts.cwd)
        await writeFile(join(opts.cwd, 'fixed.txt'), 'fixed\n')
        await git(['add', '-A'], opts.cwd)
        await git(['commit', '-q', '-m', 'Fix it'], opts.cwd)
        await git(['push', '-q', 'origin', 'HEAD'], opts.cwd)
        gitHost.open()
      })
    },
  }
}
