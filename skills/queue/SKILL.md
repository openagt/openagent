---
name: queue
description: Where the project's agent queue lives, how to read it and change it, and its format.
---

# The agent queue

The agent queue (`TODO_AGENTS.md`) lives on the branch `agent-data`, never on a code branch; your checkout does not contain it. It lists every task agents will work on next, in the order they will be taken.

Read and change it with the `queue` command, always run by its full name: `npx @openagt/skill-queue@0.1`. Every change it makes is one commit on the `agent-data` branch, pushed straight to the remote when the project shares its records. The command's `--local` and `--full` flags are for the dashboard that shows the queue; never use them. A refusal exits 1 with a line on stderr; a wrong command line exits 2 with the usage.

## Read

```
npx @openagt/skill-queue@0.1                        the open entries, in order of work, as one JSON array
```

## Change

```
npx @openagt/skill-queue@0.1 add <text> [--priority N]
                                                    put an entry on the queue; --priority (0-10) places it at the end of
                                                    that section; without it, the entry goes at the end of the file
npx @openagt/skill-queue@0.1 done <entry>           remove an entry: one quoted argument, exactly as `npx @openagt/skill-queue@0.1`
                                                    printed it; done means deleted
```

## Format

```md
## Priority 10 (critical — act immediately)

...

## Priority 9

- [Succinct description](/link-for-more-details)
- Or self-contained TODO item with complete description of what should be done

...

## Priority 0 (only if capacity)

...
```

The queue lists *all* tasks AI will work on next, sorted by priority. Priority 10 is rarely used (e.g. critical production bugs) and is treated as the utmost priority. Within a priority, the first tasks have higher priority (they are the "next" tasks within that "priority queue"). A done entry is removed (`npx @openagt/skill-queue@0.1 done`).
