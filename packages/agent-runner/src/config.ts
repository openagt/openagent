import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PERSONAL_PARTS, type PersonalSetup } from '@openagt/agent-driver'
import { parseDocument } from 'yaml'
import { RUNNER_CONFIG, RUNNER_DIR } from './names.js'

/**
 * This machine's settings for the tool: `.agent-runner/config.yml` in the project, hidden from git
 * with the rest of the directory. A missing file is no settings; a file that cannot be read as a
 * YAML map is one line on `log` and no settings either, so a broken file never stops a run.
 */
export async function readConfig(repo: string, log: (line: string) => void): Promise<Record<string, unknown>> {
  const file = configFile(repo)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return {}
  }
  const doc = parseDocument(raw)
  if (doc.errors.length > 0) {
    log(`[agent-runner] ${file}: ${doc.errors[0]!.message.split('\n')[0]}`)
    return {}
  }
  const top: unknown = doc.toJS()
  if (top !== null && (typeof top !== 'object' || Array.isArray(top))) {
    log(`[agent-runner] ${file}: the file is not a YAML map`)
    return {}
  }
  return (top as Record<string, unknown> | null) ?? {}
}

/** Where this machine's settings file is in the project, for the lines that name it. */
export function configFile(repo: string): string {
  return join(repo, RUNNER_DIR, RUNNER_CONFIG)
}

/**
 * Which parts of the person's own setup this machine's runs load: the `personal:` map in the
 * config, one line per part (`memory: off`). A part is on unless its line says off, so a run
 * loads what the coding agent loads when started by hand; anything else in the map is said on
 * `log` and changes nothing.
 */
export async function readPersonal(repo: string, log: (line: string) => void): Promise<PersonalSetup> {
  const setup: PersonalSetup = { memory: true, connectors: true, skills: true }
  const value = (await readConfig(repo, log))['personal']
  if (value === undefined || value === null) return setup
  const file = configFile(repo)
  if (typeof value !== 'object' || Array.isArray(value)) {
    log(`[agent-runner] ${file}: \`personal\` is not a map of ${PERSONAL_PARTS.join(', ')}`)
    return setup
  }
  for (const [part, on] of Object.entries(value)) {
    if (!(PERSONAL_PARTS as readonly string[]).includes(part)) log(`[agent-runner] ${file}: \`personal\` has no part \`${part}\`; the parts are ${PERSONAL_PARTS.join(', ')}`)
    else if (on === 'off' || on === false) setup[part as keyof PersonalSetup] = false
    else if (on !== null && on !== 'on' && on !== true) log(`[agent-runner] ${file}: \`personal.${part}\` is not on or off`)
  }
  return setup
}
