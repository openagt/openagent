// The keys the reads are remembered under (`usePolled`'s `remember`): the two panes read the same
// project and the same run, so a pane opened after the other, or opened again, shows what was read
// last at once, while it is read again. Without them every opening of a pane passed through
// "Looking for this run’s changes…".

/** The project's own files. */
export const projectKey = (projectId: string) => `files:project:${projectId}`

/** A run's files. */
export const treeKey = (projectId: string, agentId: string) => `files:tree:${projectId}:${agentId}`

/** A run's commits. */
export const commitsKey = (projectId: string, agentId: string) => `files:commits:${projectId}:${agentId}`

/** What one commit of a run changed. */
export const commitKey = (projectId: string, agentId: string, commit: string) => `files:commit:${projectId}:${agentId}:${commit}`
