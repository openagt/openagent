// What adding a project does to the folder, said before the person adds it: on the first page,
// beside the button, and again in the dialog that asks. One text for both, so they cannot differ.
export function AddProjectEffects() {
  const code = 'rounded bg-muted px-1'
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>Adding a project lets agents work in its folder. Adding it:</p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>makes no commit on your branch and pushes nothing</li>
        <li>
          lets OpenAgent keep its own files there, in hidden folders (<code className={code}>.openagent</code>,{' '}
          <code className={code}>.branches</code>, <code className={code}>.agent-runner</code>), and the agents&rsquo; records on a local
          branch <code className={code}>agent-data</code>
        </li>
        <li>keeps the records on this machine, unless you choose to share them</li>
        <li>
          gives each agent four basic skills in its own copy, hidden from git: <code className={code}>branches</code>,{' '}
          <code className={code}>logs</code>, <code className={code}>question</code>, and <code className={code}>github</code> when the
          project is on GitHub
        </li>
      </ul>
      <p>Agents work in their own copies, on their own branches. Your files and your branch stay as they are.</p>
      <p className="italic">A folder with no git, or a repository with no commit yet, gets one empty first commit.</p>
    </div>
  )
}
