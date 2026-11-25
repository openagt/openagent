// What adding a project does to the folder, said before the person adds it: in the dialog "Add
// your first project" opens, under the trust question it asks.
export function AddProjectEffects() {
  const code = 'rounded-sm bg-muted px-1 font-mono'
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>Adding a project lets agents work in its folder. Adding it:</p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>makes no commit on your branch and pushes nothing</li>
        <li>
          lets OpenAgent keep its own files there, in hidden folders (<code className={code}>.openagent</code>,{' '}
          <code className={code}>.branches</code>, <code className={code}>.agent-runner</code>)
        </li>
        <li>
          keeps the agents&rsquo; records in your own folder <code className={code}>~/.openagent</code>, outside the project, unless you
          choose to share them
        </li>
        <li>
          gives each agent its skills in its own copy, hidden from git: <code className={code}>branches</code>,{' '}
          <code className={code}>github</code> when the project is on GitHub, and those of the plugins on in it,{' '}
          <code className={code}>ask</code> to start with
        </li>
      </ul>
      <p>Agents work in their own copies, on their own branches. Your files and your branch stay as they are.</p>
      <p className="italic">A folder with no git, or a repository with no commit yet, gets one empty first commit.</p>
    </div>
  )
}
