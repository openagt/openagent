---
name: account-rotation
description: Add, list, remove or reorder the Claude Code and Codex accounts that coding agent runs use, when the person asks you to.
package: "@openagt/skill-account-rotation@0.1"
---

# Account rotation

A person can give a coding agent several accounts. Runs started with `@openagt/agent-runner` take the first free one, and when it hits its usage limit the same conversation goes on with the next free one. `claude` or `codex` started in a terminal stays on its own login.

Run the `account-rotation` command, always by its full name: `npx @openagt/skill-account-rotation@0.1`. It prints one JSON document; a refusal exits 1 with why on stderr; a wrong command line exits 2. Change the accounts only when the person asks.

```
npx @openagt/skill-account-rotation@0.1 list                         {"claude":[…],"codex":[…]}, each in the order runs try them
npx @openagt/skill-account-rotation@0.1 usage                        how full each account is now, where it can be read; can take 20 seconds
npx @openagt/skill-account-rotation@0.1 add <claude|codex> <name>    start adding a new account, last in the order; answers at once
npx @openagt/skill-account-rotation@0.1 adding                       {"claude":{…},"codex":{…}}, how adding stands
npx @openagt/skill-account-rotation@0.1 add-code <claude|codex>      hand the sign-in the code the person pasted, on standard input
npx @openagt/skill-account-rotation@0.1 add-cancel <claude|codex>    stop adding
npx @openagt/skill-account-rotation@0.1 remove <claude|codex> <name> take an added account off
npx @openagt/skill-account-rotation@0.1 use-first <claude|codex> <name>
                                                                     the account runs try first from now on
```

`remove` and `use-first` answer with that agent's list. An account in a list has `name`, `own` (true for the person's own login, which cannot be removed), and, when known, `who` (who a login the person gave no name is: show it, but commands take `name`), `signedOut` (the agent has no login of the person's), `computer` (the computer the person's own login is on), `limitedUntil` (epoch milliseconds, no run picks it before then) and `windows` (how full it was on its last run; `usage` says now: `windows` shortest first, and `at`, epoch milliseconds, when that is still from a last run).

`add` starts the sign-in and answers at once; it goes on by itself for up to 10 minutes. Tell the person to sign in to the account being added, not one they are already signed in to. Then read `adding` until that agent's answer has no `adding`: `{"adding":{"name":…}}` while it goes, with `url` once there is a page to sign in at, and `{"failed":…}` if it did not go through. Then the account is in `list`.

On this computer the browser opens by itself; with Codex, `url` is what the person copies into a private window if the browser is signed in to another account. On a server, give the person `url` to open on their own device. With `paste`, they bring back the code the page shows: pass it to `add-code` on standard input. With `code`, they type it at `url` themselves.

On a server, `remove` is refused: tell the person to do it in Settings › Accounts.
