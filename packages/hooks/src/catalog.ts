import { defineSetting } from './settings.js'

// The catalog (#2394): the settings modules own and other modules read, declared here beside the
// hooks, so a reader names the setting and never the module that saves it. Each is saved through
// the store, in its scope (`settings.ts`).

/**
 * The person's name and picture, as OpenAgent shows them: what they set in Settings › Profile,
 * theirs and not a git host's, the same on every computer of theirs. What is unset is the
 * computer's: git's name, and their initials.
 */
export interface PersonInfo {
  /** What they are called. */
  name?: string
  /** A picture of them: an https address. */
  picture?: string
  /** The GitHub login the name and picture were last copied from. */
  github?: string
}

/** What a person may be called: one line, at most 60 characters. */
export function isPersonName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60 && !/[\u0000-\u001f\u007f]/.test(name)
}

/** A picture's address OpenAgent keeps: only one on the web. */
export function isPictureAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** user-info's: the person's name and picture. A part that is not valid reads as unset, and the rest stays. */
export const PERSON_INFO = defineSetting<PersonInfo>({
  key: 'user-info.person',
  scope: 'person',
  default: {},
  parse: value => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const { name, picture, github } = value as Record<string, unknown>
    return {
      ...(isPersonName(name) ? { name: name.trim() } : {}),
      ...(isPictureAddress(picture) ? { picture } : {}),
      ...(typeof github === 'string' && github ? { github } : {}),
    }
  },
})
