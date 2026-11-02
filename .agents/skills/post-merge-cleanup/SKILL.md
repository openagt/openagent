---
name: post-merge-cleanup
description: Bring the project's knowledge files up to date from merged pull requests.
disable-model-invocation: true
schedule:
  every: 1h
  waits-for: when a pull request merged since the last clean-up has no clean-up yet
  when: |-
    gh pr list --state merged --limit 50 --json number,body --search "merged:>=$(npx @openagt/skill-logs@0.1 --limit 200 | jq -r '[.[] | select(.intent == "/post-merge-cleanup" and .status == "done")][0].startedAt // (now - 86400 | todate)')" | jq '[.[] | select(.body | contains("Post-merge cleanup done.") | not) | .number]'
metadata:
  version: 0.1.0
---

Write what merged work decided and taught into the project's knowledge files. Nobody will answer you: never ask, decide yourself.

What follows the command says which work: one or more pull request numbers, or nothing. When nothing follows it, the work is every pull request merged since the start of the last run of this same command that had nothing after it and ended done, as the project's record of agent runs shows, or in the last 24 hours when there is no such run, less every pull request whose body has the line `Post-merge cleanup done.`. If the pull requests cannot be read, show an error to the user saying why and stop. If there is none, say so and stop.

Read each pull request: its changes and its discussion. The knowledge files, each created when missing: `knowledge-base/DECISIONS.md`, the decisions taken and why; `knowledge-base/FACTS.md`, the non-obvious facts; `knowledge-base/INSIGHTS.md`, the insights. Write only what a future agent would need and cannot get from the code itself, and nothing the files already say. If nothing is worth writing, publish nothing. Otherwise commit, and publish the work as far as whoever started you said; when they said nothing, publish nothing. A pull request's body names the pull requests it covers and ends with the line `Post-merge cleanup done.`. Your last message names each pull request covered and what you wrote.
