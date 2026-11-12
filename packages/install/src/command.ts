import { defaultIO, install, uninstall, type InstallIO } from './install.js'

const HELP = {
  install: `Usage: npx @openagt/install

Installs OpenAgent on this computer: the dashboard starts when you log in, at https://openagent.build,
which this computer then answers itself. It asks for your password as the administrator, for that
name and its port. Typed again, it does the same, and asks nothing it needs no more.

\`npx @openagt/uninstall\` takes it all off again.

Options:
  -h, --help  Show this help.`,
  uninstall: `Usage: npx @openagt/uninstall

Takes OpenAgent off this computer: everything \`npx @openagt/install\` put on it. It asks for your
password as the administrator, for the name and its port. Your projects and their agents' records
are left as they are.

Options:
  -h, --help  Show this help.`,
}

/**
 * `npx @openagt/install` or `npx @openagt/uninstall`, typed with `argv`. Both change the computer,
 * so `--help` only says what the command does, and any other argument is refused before anything is touched.
 */
export async function runCommand(command: 'install' | 'uninstall', argv: string[], io: InstallIO = defaultIO): Promise<number> {
  const unknown = argv.find(arg => arg !== '--help' && arg !== '-h')
  if (unknown !== undefined) {
    io.err(unknown.startsWith('-') ? `unknown option: ${unknown}` : `unknown command: ${unknown}`)
    io.err(`Run \`npx @openagt/${command} --help\` for usage.`)
    return 2
  }
  if (argv.length > 0) {
    io.out(HELP[command])
    return 0
  }
  return command === 'install' ? install(io) : uninstall(io)
}
