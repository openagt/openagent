import { helpRows, helpText, unknownWord, usageError } from '@openagt/hooks/command'
import { defaultIO, install, uninstall, type InstallIO } from './install.js'

const OPTIONS = helpRows(['Options:', ['-h, --help', 'Show this help.']])

const HELP = {
  install: `Usage: npx @openagt/install

${helpText('Installs OpenAgent on this computer: the dashboard starts when you log in, at https://openagent.build, which this computer then answers itself, and `openagent` runs it in a terminal. It asks for your password as the administrator, to point openagent.build at this computer and its port 443 at the dashboard, and to put the `openagent` command in /usr/local/bin. Run again, it does the same and asks for the password again, but not for what is already in place.')}

${helpText('`openagent --uninstall` takes it all off again.')}

${OPTIONS}`,
  uninstall: `Usage: openagent --uninstall

${helpText('Takes OpenAgent off this computer: everything `npx @openagt/install` put on it, the `openagent` command too. It asks for your password as the administrator, to take off what points openagent.build at this computer and its port 443 at the dashboard. Your projects and their agents\' records are left as they are.')}

${OPTIONS}`,
}

/**
 * `npx @openagt/install`, or `openagent --uninstall` (the dashboard's command hands what follows
 * `--uninstall` here), typed with `argv`. Both change the computer, so `--help` only says what the
 * command does, and any other argument is refused before anything is touched.
 */
export async function runCommand(command: 'install' | 'uninstall', argv: string[], io: InstallIO = defaultIO): Promise<number> {
  const unknown = argv.find(arg => arg !== '--help' && arg !== '-h')
  if (unknown !== undefined) {
    io.err(usageError(command === 'install' ? 'npx @openagt/install' : 'openagent --uninstall', unknownWord(unknown)))
    return 2
  }
  if (argv.length > 0) {
    io.out(HELP[command])
    return 0
  }
  return command === 'install' ? install(io) : uninstall(io)
}
