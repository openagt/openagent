import { pageServer } from './server.js'

export const USAGE = `usage: skill-ui [--port <port>]

  shows the cards of this folder's skills on a page on this computer, until stopped`

/** The port the page asks for: the next free one when it is taken. */
const DEFAULT_PORT = 4260

export interface CliIo {
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** The folder. Default the current one. */
  cwd?: string
}

/** Listen and say where, until the process is stopped. Exit code 2 for a command line it cannot read, 1 for a port it cannot have. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const said = argv[0] === '--port' && argv.length === 2 ? Number(argv[1]) : undefined
  if (argv.length > 0 && (said === undefined || !Number.isInteger(said) || said < 0 || said > 65535)) {
    io.stderr(USAGE)
    return 2
  }
  const server = pageServer(io.cwd ?? process.cwd())
  const listen = (port: number): Promise<void> =>
    new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  try {
    await listen(said ?? DEFAULT_PORT).catch((error: NodeJS.ErrnoException) => {
      if (said === undefined && error.code === 'EADDRINUSE') return listen(0)
      throw error
    })
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
  const address = server.address()
  io.stdout(`http://127.0.0.1:${address && typeof address === 'object' ? address.port : said}`)
  return new Promise(resolve => {
    server.once('close', () => resolve(0))
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close())
  })
}
