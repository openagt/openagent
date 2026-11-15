import { execFile, spawn } from 'node:child_process'

/**
 * The `gh` CLI, in the one package that runs it (#1820). Every call the package makes to GitHub
 * goes through a runner of this shape, so a test scripts GitHub's answers and the code is the
 * same either way. And how `gh` is put on a computer that has none.
 */

/** A `gh` runner: the standard output of one invocation, with more in its environment when given; rejects with gh's own line on failure. */
export type GhRunner = (args: string[], cwd: string, env?: Record<string, string>, input?: string) => Promise<string>

/** `gh` on PATH, one minute per call: these talk to the network. */
export function nodeGhRunner(): GhRunner {
  return (args, cwd, env, input) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile('gh', args, { cwd, timeout: 60_000, ...(env ? { env: { ...process.env, ...env } } : {}) }, (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr).trim() || err.message))
        else resolve(String(stdout))
      })
      // A secret goes on standard input, never among the arguments every program here can read.
      if (input !== undefined) {
        child.stdin?.on('error', () => {})
        child.stdin?.end(input)
      }
    })
}

/** GitHub's build of `gh` for each computer it makes one for, by platform and processor. */
const BUILDS: Record<string, string> = {
  'darwin-arm64': 'macOS_arm64.zip',
  'darwin-x64': 'macOS_amd64.zip',
  'linux-x64': 'linux_amd64.tar.gz',
  'linux-arm64': 'linux_arm64.tar.gz',
}

/**
 * How `gh` is put on this computer with no admin: with Homebrew where it is, else GitHub's own
 * build for this computer, its newest, unpacked into `~/.local/bin`. One line, shown under the
 * button that runs it. None for a computer GitHub makes no build for.
 */
export function installCommand(hasBrew: boolean, platform: string = process.platform, arch: string = process.arch): string | undefined {
  if (hasBrew) return 'brew install gh'
  const build = BUILDS[`${platform}-${arch}`]
  if (build === undefined) return undefined
  const unpack = build.endsWith('.zip') ? 'unzip -q "$d/gh" -d "$d"' : 'tar -xzf "$d/gh" -C "$d"'
  return `v=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/cli/cli/releases/latest) && v=\${v##*/v} && d=$(mktemp -d) && curl -fsSL -o "$d/gh" "https://github.com/cli/cli/releases/download/v$v/gh_\${v}_${build}" && ${unpack} && mkdir -p ~/.local/bin && mv "$d"/gh_*/bin/gh ~/.local/bin/ && rm -rf "$d"`
}

/** Whether Homebrew is on this computer. */
export async function hasBrew(run: (bin: string, args: string[]) => Promise<boolean> = probe): Promise<boolean> {
  return run('brew', ['--version'])
}

function probe(bin: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(bin, args, { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('close', code => resolve(code === 0))
  })
}
