import { fileURLToPath } from 'node:url'

/**
 * Where the `branches` executable lives, for a caller that puts it on a spawned
 * process's PATH (#1725); an agent itself runs it through `npx`. Beside `dist/`, so it is the
 * same path from a workspace checkout and from an installed package.
 */
export const CLI_BIN_DIR = fileURLToPath(new URL('../bin/', import.meta.url))
