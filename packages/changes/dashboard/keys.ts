// The keys the reads are remembered under (`usePolled`'s `remember`): a pane opened again shows
// what was read last at once, while it is read again. Without them every opening of the pane
// passed through "Looking for this run’s changes…".

/** What is changed in the project's own folder. */
export const projectKey = (projectId: string) => `changes:project:${projectId}`

/** What a run changed. */
export const runKey = (projectId: string, agentId: string) => `changes:run:${projectId}:${agentId}`

/** A run's commits. */
export const commitsKey = (projectId: string, agentId: string) => `changes:commits:${projectId}:${agentId}`

/** What one commit of a run changed. */
export const commitKey = (projectId: string, agentId: string, commit: string) => `changes:commit:${projectId}:${agentId}:${commit}`
