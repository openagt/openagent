import { execFile } from 'node:child_process'
import type { GitRunner } from '@openagt/hooks'

/**
 * The shell's own git: the few reads it makes of a folder (whether it is a repository, its files,
 * its remotes, the person's name) and its tests' setup. Bounded in time, and in output for a
 * crawl of a large checkout, which prints a line per file. A module's git is its own.
 */
export function nodeGitRunner(): GitRunner {
  return (args, cwd) =>
    new Promise((resolve, reject) =>
      execFile('git', args, { cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))),
    )
}
