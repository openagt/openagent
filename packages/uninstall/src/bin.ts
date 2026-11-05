#!/usr/bin/env node
import { uninstall } from '@openagt/install'

uninstall()
  .then(code => process.exit(code))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
