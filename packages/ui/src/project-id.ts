import { basename } from 'node:path'

/**
 * Deterministic, URL-safe id for a project path: the sanitized basename plus a
 * short hash of the full path, so two repos named alike still get distinct ids.
 * Pure; same path always yields the same id. The projects module makes a listed project's id the
 * same way; the shell names the folders it serves by it too.
 */
export function projectId(path: string): string {
  // djb2, rendered as base36: short, stable, URL-safe. Not cryptographic.
  let hash = 5381
  for (let i = 0; i < path.length; i++) {
    hash = ((hash * 33) ^ path.charCodeAt(i)) >>> 0
  }
  const name = basename(path)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
  return `${name}-${hash.toString(36)}`
}
