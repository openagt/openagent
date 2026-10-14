// The keys the reads are remembered under (`usePolled`'s `remember`): a pane opened again shows
// what was read last at once, while it is read again. Without them every opening of the pane
// passed through "Looking for this run’s files…".

/** The project's own files. */
export const projectKey = (projectId: string) => `files:project:${projectId}`

/** A run's files. */
export const treeKey = (projectId: string, agentId: string) => `files:tree:${projectId}:${agentId}`

/** One opened file: a tab shown again shows it at once, while it is read again. */
export const contentKey = (projectId: string, agentId: string | undefined, path: string) => `files:content:${projectId}:${agentId ?? ''}:${path}`
