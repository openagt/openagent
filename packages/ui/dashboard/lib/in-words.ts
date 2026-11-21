/** Names in a sentence: `a`, `a and b`, `a, b and c`. */
export function inWords(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
