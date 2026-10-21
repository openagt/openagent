---
name: tickets
description: Where the project's tickets live, how to read and change them, how to claim a ticket so no two agents work the same one, how to queue one, and the formats.
---

# Tickets

The tickets (`tickets/<DATE>_<SLUG>.md`, with their `.plan.md` and `.lock.md` siblings) live on the branch `agent-data`, never on a code branch. A `tickets` link at the repository root, if present, is a possibly stale copy: never write there.

Read and change them with the `tickets` command, always run by its full name: `npx @openagt/skill-tickets@0.1`. Every change it makes is one commit on the `agent-data` branch, pushed straight to the remote when the project shares its records. Never pass `--local` or `--force`: they are a person's.

Every command prints one JSON document; a refusal is `{"ok":false,"reason":…}` with why on stderr, exit 1; a wrong command line prints the usage on stderr, nothing on stdout, exit 2. Every `<file>` below is a ticket's filename (`2042-01-01_some-ticket.md`) or the `tickets/…` path a queue entry links to; `put` also takes the ticket's `.plan.md` and `meta.json`.

## Read

```
npx @openagt/skill-tickets@0.1 list                 every open ticket, as one JSON array; a row: file, title, summary, date,
                                                    planned, and when set priority, topics, issue, pr (set: the ticket is in
                                                    review), waiting (what it waits on), effort, uncertainty, outdated (the
                                                    plan says so), locked, lockedBy
npx @openagt/skill-tickets@0.1 show <file>          one ticket: its text, its plan, who holds it
npx @openagt/skill-tickets@0.1 meta                 when the tickets last caught up with the issue tracker:
                                                    {"lastImportedAt": <ISO 8601>}, or {} when no import was recorded
```

## Change

```
npx @openagt/skill-tickets@0.1 put <file>           write one whole file under tickets/ from stdin, creating it if new
                                                    (npx @openagt/skill-tickets@0.1 put <file> < draft.md): a ticket, its plan, or meta.json
                                                    holding the object meta shows
npx @openagt/skill-tickets@0.1 close <file>         when the ticket is not wanted, when its work is done with no pull
                                                    request to merge, or for the tracker update once its pull request merged:
                                                    remove the ticket with its plan and claim; refused while someone else
                                                    holds it; its queue entry, if any, stays: `npx @openagt/skill-queue@0.1 done` it
```

## Claim before you plan or work a ticket

```
npx @openagt/skill-tickets@0.1 claim <file>         {"ok":true,"file":…,"holder":…,"earlier":[…]}: the ticket is yours;
                                                    earlier: who claimed it before you, newest first, each a run's id or
                                                    a branch; read what they did before you start
                                                    {"ok":false,"reason":"claimed","holder":…}: someone else's: pick another,
                                                    and never remove or overwrite their claim
npx @openagt/skill-tickets@0.1 release <file>       lift your own claim when the plan or the work is done, and before you
                                                    stop unless you closed the ticket: nothing lifts a claim on a timeout
                                                    {"ok":true,"file":…,"holder":…}: your claim is lifted
                                                    {"ok":false,"reason":"no-lock"}: nobody holds it: nothing to lift
                                                    {"ok":false,"reason":"not-holder","holder":…}: someone else holds it:
                                                    leave their claim
```

`put` ignores claims. You claim as `AGENT_ID` when it is set and not blank, else as your current branch: release from the branch you claimed on, or the claim stays until a person lifts it.

## Queue a ticket

When the repository has the `queue` skill, a ticket goes on the agent queue as a link, its title as the label, at the ticket's own `Priority:` (5 when it has none):

```
npx @openagt/skill-queue@0.1 add '[<title>](tickets/<file>)' --priority <N>
```

Once the work is committed and its pull request is open: `npx @openagt/skill-queue@0.1 done` the entry, its exact text, write the pull request into the ticket as its `PR:` line (`put` the whole ticket, the line added above the title), and release your claim. The ticket is in review. Do not close it: it closes when the pull request merges, through the update from the issue tracker, which reads the line `Closes tickets/<file>` in the pull request's body; add `Closes #<number>` when the ticket has an issue.

## Formats

### A ticket: `tickets/<DATE>_<SLUG>.md`

`<DATE>` is yyyy-mm-dd, `<SLUG>` a succinct kebab-case slug of the title.

```md
Priority: 0-10 [optional; 10: critical, act immediately; 0: only if capacity]
Topics: [list-of-topics] [optional]
Issue: [#42](https://example.com/org/repo/issues/42) [optional: the issue this ticket tracks]
PR: [#1790](https://example.com/org/repo/pull/1790) [optional: the pull request that closes it]
Waiting: what it waits on [optional: no agent is handed it until a person removes the line]

# Ticket title

## TLDR

...

## Why it matters

...

[optional: more, under any heading]
```

A ticket with a `PR:` line is in review: skip it when choosing work, and never queue it while the line stands; remove the line to have it worked again. A `Waiting:` line names what the ticket waits on outside the work: skip the ticket when choosing work, and never queue it, nor a plan for it, while the line stands; only a person removes the line, when the wait is over. `Priority:` is a bare whole number from 0 to 10 above the `# ` title; anything else queues at 5.

### A claim: `tickets/<DATE>_<SLUG>.lock.md`

One line, `CLAIMED: <holder>`. Written by `claim`, removed by `release` or `close`.

### A plan: `tickets/<DATE>_<SLUG>.plan.md`

```md
Effort: 0-10 [0: trivial, 10: takes months]
Uncertainty: 0-10 [0: no meaningful alternatives, 10: highly uncertain how to implement]
Outdated: yes [optional: the ticket changed in a way that makes the plan outdated; a plan written again leaves it out]

# [Plan] Ticket title

One sentence saying what this file holds.

## Problems [optional: what is uncertain to implement, and why]

## Solutions [optional: ways to solve each problem, shortcuts included]

## Considerations [optional: everything to weigh, edge cases included]

## Implementation [optional: the concrete plan]

[optional: more, under any heading]
```

`Effort:` and `Uncertainty:` are bare whole numbers above the title, else absent. The uncertainty counts *significant* alternatives, not variability like syntax, and decides whether a human is needed before the work: 0 means clearly not.
