Topics: automations, dashboard
Issue: [#2040](https://github.com/openagt/openagent/issues/2040)

# New automation: say the shell line in plain words

## TLDR

In the "New automation" form, a box takes plain words for what the row waits for ("when someone comments on an issue"). A button starts a short agent in the project that answers with one shell line using `$LAST_RUN`; the form puts it into the shell line box. Nothing is saved: "Try it" runs it as today, and the person reads, edits and saves the row themselves. Later, not now.

Follows #2032, which left this open.

Not part of this: the agent saving the row.

## Why it matters

A row that starts when something new appears needs a shell line printing the new thing (`gh api … --jq …`), which only someone who knows the command line can write today.

## Open questions

1. Each press starts an agent and costs a few cents: whether the form says so before the press.
2. Whether the agent may run the line itself to check it, or only writes it.
