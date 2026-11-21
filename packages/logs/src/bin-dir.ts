import { fileURLToPath } from 'node:url'

/**
 * Where the `logs` executable lives, for a caller that puts it on a spawned process's PATH; an
 * agent itself runs it through `npx`. Beside `dist/`, so it is the same path from a workspace
 * checkout and from an installed package.
 */
export const CLI_BIN_DIR = fileURLToPath(new URL('../bin/', import.meta.url))

/** The skill's name: the `name` in `SKILL.md`'s front matter, and the directory a harness lists it under. */
export const SKILL_NAME = 'logs'

/** This package's directory — the one holding `SKILL.md`. Beside `dist/`, like the executable. */
export const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url))
