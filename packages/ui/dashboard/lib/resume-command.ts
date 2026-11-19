import type { SessionInfo } from '../../src/index.js'

// The shell one-liner that picks a session back up in a terminal (#1195).
//
// The dashboard knew the agent's session id and never showed it, so a session you wanted to
// continue outside the dashboard was unreachable: the conversation was on disk and you had no way
// to name it. The id alone is not enough either — the CLI finds a session by the directory it ran
// in, and that directory is usually gone by the time you want it, since an agent that finishes
// cleanly has its worktree removed. So the command recreates the path first; an empty directory
// is enough for the CLI to match the session and read the conversation back.
//
// Deliberately no permission-mode flag: this lands in someone's terminal, and what an agent is
// allowed to do once it reopens is that person's call to make at the prompt, not ours to preset.
//
// With no directory recorded (an older agent, or one that never opened a session) the id is still
// worth handing over on its own, so the caller can say which of the two it copied.
export function buildResumeCommand(
  session: Pick<SessionInfo, 'sessionId' | 'workspace'> | null | undefined,
): string | null {
  const id = session?.sessionId
  if (!id) return null
  const dir = session.workspace
  if (!dir) return id
  // The path is wherever the user keeps the repo — quote it so a space (routine on macOS,
  // `/Users/John Doe/…`) doesn't split the command.
  const q = `'${dir.replaceAll("'", `'\\''`)}'`
  return `mkdir -p ${q} && cd ${q} && claude --resume ${id}`
}
