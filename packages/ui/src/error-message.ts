/**
 * The message of an unknown caught value. `catch` hands back `unknown`, and this ternary was
 * spelled out at over twenty call sites; the next variation in one of them would be a bug (a
 * dropped `String()` turns a thrown string into `[object Object]`'s sibling problems), so the
 * idiom gets one home. Node-free, exported through /client for the dashboard's use too.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
