import { useLoaded } from './use-async.js'
import { onEditors, type EditorInfo } from '../rpc/preferences.js'

// The editors installed on the daemon's machine (#727), for the "Preferred editor" picker. Read
// once over its RPC; a public host (no local checkout) returns [], so the picker shows only the
// escape-hatch "Default". Detection is cheap (a PATH lookup), so a plain read-once is enough.

/** The detected editors, loaded once from the daemon. `[]` until the read resolves. */
export function useDetectedEditors(): EditorInfo[] {
  return useLoaded(() => onEditors(), [], [])
}
