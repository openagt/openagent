Effort: 4
Uncertainty: 5

# [Plan] New gate: let agent gauge uncertainty

How to add a publish level where the agent rates its own uncertainty and either lets its pull request merge on green or asks a person first.

## Where the gate goes

Today a person picks, before the run, how far it takes its work: the "Auto" menu's publish levels (`packages/dashboard/src/publish-levels.ts`: Off, Commit, Publish branch, Open PR, Merge on green), the same words the scheduler keeps per scheduled command (`packages/skill-scheduler/src/state.ts`, `PublishPick`) and the runner turns into one sentence after the prompt (`PUBLISH_LINES` in `packages/agent-runner/src/run.ts`). "Open PR" always waits on a person; "Merge on green" never does. The gate is the level between them: the agent decides which of the two applies to this piece of work.

Nothing else needs building to act on the decision: `npx @openagt/skill-github@0.1 open --merge` arms the merge (also on a request already open, so a resumed run fixing red CI arms it too), `--draft` opens one for review, and the `ask` skill's `await-choices` block ends the run `waiting`, lists it on the Human Queue, and a pick resumes the same run.

## Problems

1. **What "confident" means.** An agent's self-rating is poorly calibrated; a bare "if you are confident" merges nearly everything.
2. **How a doubtful run asks.** Either it opens the request (draft, no merge) and ends, leaving it to a person to merge from the agent's page; or it asks with an `await-choices` question (e.g. "Merge it" / "I'll review it" / the alternatives it saw) so the answer comes back to the same run.
3. **Who decides the bar.** A fixed bar in the sentence, or a threshold the person sets (an uncertainty number on the level).

## Solutions

1. Give the agent the same scale and words the ticket plans already use (`Uncertainty:` 0-10, counting *significant* alternatives a person might pick differently, not variability like syntax), plus risk: the merge is armed only at uncertainty 0 *and* when the change touches nothing a person would want to see first (data loss, security, public interface, money, a migration). Anything else is the person's. The skill-orchestration and skill-triage packages already gate on "uncertainty 0" in the same way, so the bar is one the project uses elsewhere.
2. Recommended: open the request without the merge, then ask with the `ask` skill's block, options "Merge it" (detail: what was checked) and "Leave it for review", plus one option per alternative it saw. Waiting runs already reach the Human Queue and the phone notifications; a draft alone is easy to miss. The resumed run's "Merge it" answer arms the merge with `open --merge`. Fallback for an agent run where nobody answers (GitHub Actions, subagents): the request stays open for review, never merged.
3. Recommended: a fixed bar, no number to pick. A threshold setting is a second control for a gate meant to save the person attention; it can come later if the fixed bar proves too strict.

## Considerations

- Every level's sentence is one sentence after the prompt and says nothing of how: the how is the skills'. This level's sentence must carry the bar, so it is longer than the others; keep the bar's wording in one place (the runner's sentence) and not also in the `github` skill.
- The agent writes its rating and the reason in the pull request body ("Uncertainty: 0 — merged on green because…" / "Uncertainty: 4 — left for review: the alternatives were…"), so a person can audit the gate's calls after the fact and tune the bar.
- A run on a person's pull request (the `replies` flow) never arms a merge of the person's request, whatever its rating: the existing rule that the person's request is theirs stands.
- Projects without a git host do not get the level (as with Open PR / Merge on green: `offeredPublishPicks`).
- A message or resume with `--publish` can move a run to or from this level part way, as with every level; nothing special.
- The example in the ticket (CI red, the agent fixes it): the scheduler's `reply` row runs at its own publish pick per machine; picking this level there gives exactly "confident fix → merge, otherwise ask".
- Codex and Claude Code read the same sentence; check both follow it (the `ask` skill's DECISIONS record that some models skip instructions worded loosely), with the demo (`pnpm demo`) and one real run each.

## Implementation

1. `packages/agent-runner/src/records.ts`: add the level to `PUBLISH_LEVELS`, between `pr` and `merge`; name it `confident` (label "Merge if confident").
2. `packages/agent-runner/src/run.ts`: its `PUBLISH_LINES` sentence, roughly: "When you finish, if you changed any file, commit your work, push your branch and open its pull request. Rate your uncertainty 0-10 (the significant alternatives a person might pick instead) and say it with why in the request; set it to merge on its own once its checks pass only at 0, when the change risks nothing a person would want to see first; otherwise ask the person whether to merge it." Keep `addedLine`'s `into the branch …` replacement working. Update `cli.ts` usage text and the runner's DECISIONS bullet on levels.
3. `packages/dashboard/src/publish-levels.ts`: the level and its label; `AutoMenu.tsx`'s description ("It opens a pull request, and sets it to merge on green only when it is sure; otherwise it asks you."); `AutoMenu` already treats `pr`/`merge` as opening a request: add the new level there. `fake-run-bin.ts` and `registry.ts` take the level through `isPublish`.
4. `packages/skill-scheduler/src/state.ts` and its `publish` command: the level comes for free through `PUBLISH_LEVELS`; check the usage text and status lines.
5. Tests: the runner's sentence per level, the menu's picks and labels, the scheduler accepting the level; an e2e story in `packages/dashboard/src/e2e/` where a scripted agent at this level asks (Human Queue lists it) and the "Merge it" answer resumes it.
6. DECISIONS: once a person picks among the solutions above, write the bullets (`packages/agent-runner/DECISIONS.md`, `packages/dashboard/DECISIONS.md`).
