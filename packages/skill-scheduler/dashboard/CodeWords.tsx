import { CopyButton } from '@openagt/dashboard/module'

/** A sentence of the `scheduler` command, its `backticked` words set as code: what a person types is shown as such. */
export function CodeWords({ text }: { text: string }) {
  return text.split('`').map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="rounded-sm bg-muted px-1 font-mono">
        {part}
      </code>
    ) : (
      part
    ),
  )
}

/** A command to run in the project, on a strip of its own under the sentence that says what it does: set as code, kept on one line that scrolls sideways, with a button that copies it, named by the command's last word ("Copy the start command"). */
export function Command({ text }: { text: string }) {
  return (
    <div className="mt-2 flex w-fit max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 text-foreground">
      <code className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-xs whitespace-nowrap">{text}</code>
      <CopyButton text={text} label={`Copy the ${text.split(' ').at(-1)} command`} className="size-6 justify-center max-md:size-11" />
    </div>
  )
}
