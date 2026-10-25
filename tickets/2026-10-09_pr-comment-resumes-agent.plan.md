Effort: 3
Uncertainty: 3

# [Plan] A comment on an agent's pull request resumes that agent

What is left of the ticket now that most of it is built, and how to do it.

## Already built

Checked against the code on `main` (b6af130be). Items 1–10 of the TLDR are done. Only build-order steps 3 and 4 are left.

- **Resume rows (TLDR 1):** a row with `each: true` prints one item per run, `{ "run", "text" }` to resume or `{ "for", "text" }` to start (`eachItems`, `packages/skill-scheduler/src/schedule.ts:410`). `eachNamed` (`packages/skill-scheduler/src/tick.ts:285`) resumes each one. The scheduler names no git host.
- **Agent, model, readiness, quota per run (2):** done in `whyNot`/`mayStart`, `tick.ts:315`. A run that cannot go now gets one line and is tried again at a later tick.
- **New means after the run ended (3):** done in `packages/skill-github/src/replies.ts`, using the record's `endedAt`. No time is stored.
- **Only this machine's runs (4):** `whyNot` checks `mark.host !== deps.host`.
- **`replies` (5):** `agent-runner git-host replies --since "$SWITCHED_ON"` → `replies.ts`. It costs one GitHub call per look, with an ETag cache, and a full read at least once a minute. It covers comments, reviews, line comments, red checks and conflicts, and puts 👀 on whatever it hands over.
- **The `reply` skill (6):** `skills/reply/SKILL.md`, package `packages/skill-reply`. It checks every 15s.
- **Automations page (7):** `packages/skill-scheduler/dashboard/schedulers.ts:55,109` and `EditPanel.tsx` say that resumed runs keep their own coding agent, model and publish level.
- **Maintainers only (8):** `MAINTAINERS`, plus the 🤖 line and `COMMENT_MARK` skipped. A person picked something narrower than the ticket: only words that call `/agent` count, even on the agent's own pull request (`packages/skill-reply/DECISIONS.md`, "Only maintainers' comments count…"). The ticket's point 8 and its first sentence still say "a comment". The ticket text is out of date; the code is right.
- **Conversation gone (9):** `afresh` (`packages/agent-runner/src/run.ts:771`) starts the session again, attaching `earlierWorkLine(run.id, run.card.pr)`. It runs when the record has no session id or the agent throws `ConversationGoneError`.
- **Pull request with no run (10):** `/agent` there starts a run whose record names the thread (`{ "for": … }` items). That is the "later, worth a try" part, also done.

## What is left

1. **Build step 4: the run's page shows what woke the run, with its link.** Today a resumed run's page shows the whole resume text as a plain message from the person: `/reply`, the scheduler's opening sentence, then the check's lines, with each comment's URL inline. Only the record's `resumed: { by, at }` says a row did it, and only for the latest resume.
2. **Build step 3: a trial on a test repository.** A run opens a pull request. Then a `/agent` comment, a failing check and a conflicting merge to `main` must each be answered by that same run. This was never recorded as done.

## Problems

- **Where the link comes from.** The dashboard should not parse the scheduler's sentences or GitHub's words (`answeredQuestion` parses the runner's own question prompt, which is a different case). The links have to travel as data from the check, through the scheduler and the runner, to the diary.
- **Where it is kept.** `resumed` on the record's mark only holds the latest resume. A run woken five times needs the source on each prompt, so it belongs in the diary line of that turn's prompt, not on the card.

## Implementation

1. **Check item:** `{ "run", "text", "from"?: [{ "label", "url" }] }`, where each entry is one thing that woke the run (`@alice commented`, `The check "test" failed`, `It conflicts with main`). `replies.ts` already has the URL and the words in each `Came`: give `Came` a `label`, and have `told()` return `from` next to `text`. `StartItem` gets the same field, so a run started by `/agent` shows its call too.
2. **Scheduler:** `ResumeItem`/`StartItem` and `eachItems` read and validate `from`; a malformed entry is dropped, not the whole item. When several items name the same run they are merged, so their `from` entries are concatenated. `TickDeps.resume` gets `from`, and the start path passes it the same way. No sentence about it is added to the text: the agent already reads the links in its words.
3. **Runner:** `agent-runner run --resume <id> --from <json>` (and the same on start) keeps `from` on that turn's prompt line in the diary, next to the row (`by`). Neither the card nor the mark holds it.
4. **Dashboard (`packages/openagent/dashboard/components/EventList.tsx`):** a prompt line carrying `by` and `from` is drawn as a box, not a message bubble, the way an answered question is. The title is "Continued by <row>", followed by one link per `from` entry. The full text it was told sits in a folded "What it was told". A prompt with `by` but no `from` (a check that gives no links) gets the title alone.
5. **Tests:** `replies.test.ts` (each item has `from`), `schedule.test.ts` (`from` is read; a malformed entry is dropped), `tick.test.ts` (`from` reaches `resume` and start), `run.test.ts` (the diary's prompt line keeps `from`), and an `EventList` test (the box, its links, the folded text).
6. **The trial (build step 3),** after the above is merged and published: on a test repository with the `reply` row switched on, open a pull request through a run, then (a) comment `/agent please rename x`, (b) push a failing test to its branch from another clone, (c) merge a conflicting change to `main`. Each must resume that same run id (the scheduler's decision line `resumed <id>`), get 👀, a new comment answering it, and, for (b) and (c), a push. For (c) that push is a merge commit, with no force push. The run page shows the three boxes with their links. Write down what failed as new tickets. It needs a GitHub repository the agent can write to and the scheduler running on the machine. If neither exists, the ticket waits on a person to provide them after steps 1–5 are merged.

## Considerations

- The 👀 and the links name the same things. `Came.seen` (the GitHub node id) and the new `label`/`url` sit on the same `Came`, so they cannot drift apart.
- A check from another git host, or a person's own automation, that prints no `from` keeps working unchanged.
- The ticket's text is outdated about which comments count (see point 8 above). Whoever next updates the ticket should change "a comment" to "a maintainer's `/agent` call, a red check or a conflict". This plan builds what the code and `DECISIONS.md` say.
