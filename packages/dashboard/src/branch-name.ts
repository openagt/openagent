/**
 * Whether `value` names a branch the way git lets a branch be named (`git check-ref-format
 * --branch`), told without running git. The branch a Start names to start from ends up on a
 * command line, so a word that could be read there as an option (a leading `-`), or that git would
 * read as something other than one branch (`a..b`, `x@{1}`, `HEAD`), is not a name.
 */
export function isBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > 255) return false
  if (value === 'HEAD' || value === '@' || value.startsWith('-')) return false
  // What git refuses anywhere in a ref: a space, a control character, and the characters its
  // revision syntax uses.
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(value) || value.includes('..') || value.includes('@{')) return false
  if (value.endsWith('.')) return false
  return value.split('/').every(part => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'))
}
