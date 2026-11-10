import { CopyButton } from '@openagt/dashboard/module'

/** A sentence of the `scheduler` command, its `backticked` words set as code: what a person types is shown as such. */
export function CodeWords({ text }: { text: string }) {
  return text.split('`').map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="rounded bg-muted px-1 font-mono">
        {part}
      </code>
    ) : (
      part
    ),
  )
}

/** A command to run in the project, on a line of its own: set as code, with a button that copies it. What it does is the sentence's before it, so every command lays out alike. */
export function Command({ text }: { text: string }) {
  return (
    <span className="my-1.5 flex items-center gap-2">
      <code className="min-w-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all text-foreground">{text}</code>
      <CopyButton text={text} label="Copy the command" />
    </span>
  )
}
