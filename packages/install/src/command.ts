import { helpRows, helpText, unknownWord, usageError } from '@openagt/agent-data'
import { defaultIO, install, uninstall, type InstallIO } from './install.js'

const OPTIONS = helpRows(['Options:', ['-h, --help', 'Show this help.']])

const HELP = {
  install: `Usage: npx @openagt/install

${helpText('Installs OpenAgent on this computer: the dashboard starts when you log in, at https://openagent.build, which this computer then answers itself. It asks for your password as the administrator, to point openagent.build at this computer and its port 443 at the dashboard. Run again, it does the same and asks for the password again, but not for what is already in place.')}

${helpText('`npx @openagt/uninstall` takes it all off again.')}

${OPTIONS}`,
  uninstall: `Usage: npx @openagt/uninstall

${helpText('Takes OpenAgent off this computer: everything `npx @openagt/install` put on it. It asks for your password as the administrator, to take off what points openagent.build at this computer and its port 443 at the dashboard. Your projects and their agents\' records are left as they are.')}

${OPTIONS}`,
}

/**
 * `npx @openagt/install` or `npx @openagt/uninstall`, typed with `argv`. Both change the computer,
 * so `--help` only says what the command does, and any other argument is refused before anything is touched.
 */
export async function runCommand(command: 'install' | 'uninstall', argv: string[], io: InstallIO = defaultIO): Promise<number> {
  const unknown = argv.find(arg => arg !== '--help' && arg !== '-h')
  if (unknown !== undefined) {
    io.err(usageError(`npx @openagt/${command}`, unknownWord(unknown)))
    return 2
  }
  if (argv.length > 0) {
    io.out(HELP[command])
    return 0
  }
  return command === 'install' ? install(io) : uninstall(io)
}
