---
name: discord
description: Post a message to the team's Discord channel from the shell, when a task asks you to tell people something there.
---

# Discord

Post one message to a Discord channel with the `discord` command, always run by its full name: `npx @openagt/skill-discord@0.1`.

```
npx @openagt/skill-discord@0.1 send "<message>"     post the message to this machine's webhook
npx @openagt/skill-discord@0.1 status               whether this machine has a webhook, and where it comes from
```

Quote the message as one argument. It is posted as a Discord message, so Discord's markdown formats it (`*`, `_`, backticks), up to 2,000 characters (a longer one is cut and says so); `@everyone` and other mentions in it do not ping anyone.

The channel is the one whose webhook this machine was given, by a person: `npx @openagt/skill-discord@0.1 setup <webhook>` saves it for this user on this machine, `npx @openagt/skill-discord@0.1 setup --clear` forgets it, and `DISCORD_WEBHOOK` in the environment wins over the saved one. Never ask for the webhook, never print it, and never write it into the repository: anyone holding it can post to the channel.

`send`, `setup` and `status` print one JSON line on stdout. A refusal exits 1 with the reason on stderr: `no-webhook` (none on this machine: say so and go on, a person sets it), `not-posted` (Discord or the network refused it; the detail says which, never the URL), `empty`, and for `setup`, `invalid`. A wrong command line exits 2 with the usage on stderr.

## A message when a run needs you

A tool that runs coding agents may run a line of the person's when a run ends, with the message in `$MESSAGE`. This is the line:

```
npx @openagt/skill-discord@0.1 send "$MESSAGE"
```
