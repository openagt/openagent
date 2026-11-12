#!/usr/bin/env node
import { runCommand } from '@openagt/install'

runCommand('uninstall', process.argv.slice(2))
  .then(code => process.exit(code))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
