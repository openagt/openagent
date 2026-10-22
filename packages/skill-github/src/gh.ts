/**
 * The `gh` CLI, in the one package that runs it (#1820). Every call the package makes to GitHub
 * goes through a runner of this shape, so a test scripts GitHub's answers and the code is the
 * same either way.
 */

/** A `gh` runner: the standard output of one invocation, with more in its environment when given; rejects with gh's own line on failure. */
export type GhRunner = (args: string[], cwd: string, env?: Record<string, string>) => Promise<string>

/** `gh` on PATH, one minute per call: these talk to the network. */
export function nodeGhRunner(): GhRunner {
  return async (args, cwd, env) => {
    const { execFile } = await import('node:child_process')
    return new Promise<string>((resolve, reject) => {
      execFile('gh', args, { cwd, timeout: 60_000, ...(env ? { env: { ...process.env, ...env } } : {}) }, (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr).trim() || err.message))
        else resolve(String(stdout))
      })
    })
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
