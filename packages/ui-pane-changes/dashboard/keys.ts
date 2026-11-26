// The keys the reads are remembered under (`usePolled`'s `remember`): a pane opened again shows
// what was read last at once, while it is read again. Without them every opening of the pane
// passed through "Looking for this session’s changes…".

/** What is changed in the project's own folder. */
export const projectKey = (projectId: string) => `changes:project:${projectId}`

/** What a run changed. */
export const runKey = (projectId: string, agentId: string, repo = '') => `changes:run:${projectId}:${agentId}:${repo}`

/** A run's commits. */
export const commitsKey = (projectId: string, agentId: string, repo = '') => `changes:commits:${projectId}:${agentId}:${repo}`

/** What one commit of a run changed. */
export const commitKey = (projectId: string, agentId: string, commit: string, repo = '') => `changes:commit:${projectId}:${agentId}:${repo}:${commit}`

/** One file's diff, as last read. */
export const diffKey = (projectId: string, agentId: string | undefined, path: string, commit: string | undefined, whole: boolean, repo = '') =>
  `changes:diff:${projectId}:${agentId ?? ''}:${repo}:${commit ?? ''}:${whole ? 'whole' : 'near'}:${path}`
