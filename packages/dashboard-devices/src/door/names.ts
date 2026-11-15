/**
 * A person's name, which is who they are on a computer: typed at the invite, whatever git host they
 * use. As it is typed, as it is written where only plain letters go, and whether two names are one
 * person's. And a computer's name, as it says it.
 */

/**
 * A person's name as it is typed: letters of any language, digits, spaces, dots, apostrophes and
 * dashes, at most 40, starting with a letter or a digit, on one line. Spaces around it are
 * dropped, and two in a row are one.
 */
export function nameOf(said: string): string | undefined {
  const name = said.trim().replace(/ +/g, ' ')
  // A name is one line: one that breaks a line, or hides a letter, is no name.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) return undefined
  return /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'’-]{0,39}$/u.test(name) ? name : undefined
}

/** Why `said` is no name, in the words a command refuses it with. */
export const notAName = (said: string): string => `${said} is not a name: letters, digits, spaces, dots, apostrophes and dashes, at most 40`

/**
 * A name as it is written where only plain letters go: a header, the file a person's service
 * reads, the helper's word. Every letter that is not a plain one is `%` and its number.
 */
export const nameWord = (name: string): string => encodeURIComponent(name).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** A name written as {@link nameWord} writes it, as it was; `undefined` for a word that is no name. */
export function nameFromWord(word: string): string | undefined {
  try {
    return nameOf(decodeURIComponent(word))
  } catch {
    return undefined
  }
}

/** Whether two names are one person's: their letters' case is not looked at. */
export const samePerson = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/** A computer's name as it says it, safe to show: any words, with nothing in it that moves a line, and not too many of them. */
export const shownName = (said: string): string => said.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 60)
