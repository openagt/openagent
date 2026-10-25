Effort: 8
Uncertainty: 6
Outdated: yes

# [Plan] People on a shared computer: each person's own runs, logins and laptops

How to build the five pull requests in the ticket. PR 1 (persons) is planned down to the code. PRs 2 to 5 get their open questions and a recommended way to solve each.

## Problems

1. **Running a person's agents as their own system user (PR 2).** Today the daemon runs as one user (`openagent` on a server). Every run goes through `onStart` (`openagent/src/daemon-runtime.ts:244`) and then `runStartHook` (`openagent/src/project-hooks.ts:176`), which calls `sh -c`. From there `agent-runner` `spawnDetached` (`agent-runner/src/runner.ts:126`) starts the run with `{...process.env}`. Nothing switches the user or the environment for a person.
2. **Proving who a call is from, on the computer itself (PR 3).** OpenAgent on `127.0.0.1:4200` checks no key (`openagent/src/dashboard/server.ts`). It trusts loopback, Origin, Host and `sec-fetch`. Any local process can send any header, so a header naming the person can be forged by an agent on the computer.
3. **Each person's own copy of a project (PR 2/3).** Projects live in one registry, `openagent/src/registry.ts`, owned by the daemon's user. Each person needs a copy in their own home, not one shared folder.
4. **Lines per person (PR 4).** The line addresses in `remote-access/src/line-in.ts` take no key. `tellOpenAgent` (:314) saves them as machines for everyone.

## Solutions

1. **Per-person user.**
   - (a) **Recommended:** one OpenAgent daemon per person, run as that person's system user (`oa-<login>`), on a port of its own. The door sends each person's calls to their own daemon. The owner's daemon is the one that exists today.
     - Every check stays where it is today: each daemon serves one person, so PR 3 becomes "the door picks the daemon" instead of filtering inside one daemon.
     - Each person's projects, logins (`gh`, `claude setup-token`) and runs sit in their own home with no new code in the run path.
   - (b) One daemon that starts each run with `sudo -u oa-<login>`. This needs a sudoers rule and an environment passed across `sudo`. Every RPC that reads runs, projects or logins would then need a person filter. That is much more code, and every RPC is a place a check can be missed.
2. **Calls on the computer itself.**
   - With 1(a), each daemon listens on a port that only its own user may reach. Use a Unix socket with mode 0600 in place of a TCP port. The door runs as root, or as a group member of each socket.
   - An agent of person B then cannot reach A's daemon. This closes the `127.0.0.1:4200` gap the ticket names.
   - Until then (PR 1), the person header is shown on the page only. Nothing is decided from it.
3. **Projects:** with 1(a), they come for free. Each daemon has its own registry and clones into its own home.
4. **Lines:**
   - Each device line gets a `person` and a `for: 'me' | 'everyone'`.
   - `tellOpenAgent` registers the line address only with the daemons of the people allowed to use it.
   - The line address becomes a Unix socket per line, readable by those people's users only.

## Considerations

- **A computer only one person uses must not change.** Nothing new runs until "Someone else" is first picked: no owner question, no new user, no `gh` needed.
- **Telling who a person is, in PR 1:**
  - The one-time code is the only proof, as it is for a device today.
  - The person header comes from the door alone. The door removes any copy a request brings, so a device cannot claim to be someone else through the door.
  - A local process can still send the header straight to 4200. That is harmless in PR 1, where the header only names who the page is opened as. PR 3 must not trust it until Solution 2 is in.
- **GitHub accounts** are compared without regard to case. They must match `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`; the `isAccount` check in `servers` is already there to reuse.
- **Who the owner is:**
  - On a server, the owner is the laptop's GitHub account (`ownGithubAccount`, `servers/src/logins.ts:30`).
  - On a computer at home, it is the `login` the dashboard already reads (`readPerson`, `openagent/src/dashboard/person.ts:21`).
  - With no `gh` login there, "Someone else" says to log in to GitHub first and offers nothing else.
- **Removing a person** removes every one of their devices, and their codes that have not been used yet. Removing the owner is refused.
- **Breaking changes are fine (AGENTS.md).** The store keeps no old shape:
  - A device with no `person` belongs to the owner. That is the same meaning the file has today, so nothing needs migrating.
  - Once the owner is named, their devices stay unlabelled in the file and are listed under the owner.
- **The Invite dialog must say plainly, until PR 4,** that an invited person can do everything this page can do.

## Implementation (PR 1: persons)

### `remote-access`

- **`src/store.ts`**
  - `Store` gains:
    - `owner?: string`, the owner's GitHub account.
    - `persons: Person[]`, where `Person = { login: string; added: string }`, for the invited people other than the owner.
  - `Device` and `Code` gain `person?: string`. Absent means the owner.
  - `sanitize` copies all of these through:
    - It keeps a `person` only when it names `owner` or a listed person.
    - It drops a device or code that names a person who is no longer listed.
    - Caps: `MAX_PERSONS = 20`.
  - New functions:
    - `nameOwner(env, login)`: sets `owner` once. It refuses a different login when an owner is already set; a person changes that by hand in the file.
    - `addPerson(env, login)`
    - `removePerson(env, login)`: takes the person out with their devices and codes.
  - `addCode(env, now, person?)` stores the person on the code. It refuses when the person is not listed. Inviting someone else first adds them with `addPerson`.
  - `enter` copies the code's `person` onto the new `Device`.
- **`src/cli.ts`**
  - `add [--for <account>]`:
    - Refuses `--for` while no owner is named, with: "name the owner first: remote-access owner <account>".
    - Adds the person when they are new.
  - New commands:
    - `owner [<account>]`: prints the owner, or names them.
    - `persons`
    - `remove-person <account>`
  - `status` gains `owner` and `persons`, and each listed device gains `person` (the owner's login when it has none and an owner is named).
  - `USAGE` lists the new commands.
- **`src/door.ts`**
  - New `PERSON_HEADER = 'x-openagent-person'`.
  - `passOn` always deletes the incoming header. It then sets it to the device's `person ?? store.owner`, or leaves it out when neither is set. To do that, `whoIsIn` returns the `Device`, not only the `Entry`.
  - The enter answer gains `person` so the page can say "You are in as @x on <server>". For a browser, the page reads it from the 200 JSON.
- **Tests:** next to the existing `store.test.ts`, `cli.test.ts` and `door.test.ts`, cover:
  - Naming the owner, and refusing a second one.
  - `add --for` making a code that is tied to the person.
  - `enter` giving the device its person.
  - `removePerson` cascading to devices and codes.
  - `sanitize` dropping devices and codes that name an unknown person.
  - The door stripping a forged header and setting the real one.

### `servers`

- **`src/steps.ts`**
  - `linkScript(person?)` passes `--for "$PERSON"` through the script's environment, as `removeDeviceScript` does with `ID`.
  - New `ownerScript(login)` runs `remote-access owner "$LOGIN"`.
  - New `removePersonScript(login)`.
- **`src/install.ts` `askLink(server, { person })`**
  - When a person is given and the server has no owner yet (read from `status`), it names the owner first with `ownGithubAccount()`.
  - If that account is missing, it returns the error `noGh` gives.
- **`src/devices.ts`**
  - `devicesIn` parses `owner`, `persons` and the device's `person`.
  - `ServerDevice` gains `person`.
  - New `removePerson`.
- **`src/cli.ts`**
  - New `servers link <address> [--for <account>]`.
  - New `servers remove-person <address> <account>`.
- **`dashboard/MachinesSettings.tsx`**
  - The server row's Invite opens the dialog's new "Who is it for?" step (below).
  - "Who is in" (:274) groups devices by person: owner first, then each person with a "Remove person" button and their devices.

### `openagent` dashboard

- **`dashboard/components/InviteDialog.tsx`**
  - New prop `forPerson?: { owner?: string; ask: (person: string | undefined) => Promise<InviteAnswer> }`.
  - When it is given, the dialog opens on a first step:
    - "Me: my phone or my browser"
    - "Someone else: their GitHub account", with an input checked against the account pattern.
  - The first time "Someone else" is picked, the step shows "You are @<owner> on this computer" for the owner to confirm.
  - After that the code step is as today, titled "For @<login>. Send them the link.", with the line: "Until people get their own runs, @<login> can do everything this page can."
  - Without the prop, the dialog is unchanged.
- **`remote-access/dashboard/DevicesSettings.tsx` and `devices.ts`**
  - The same step for this computer's own Devices page. `readLink(person?)` passes `--for`.
  - The owner comes from the `person` RPC's `login`, and is named with `remote-access owner` before the first `--for`.
  - Devices are listed grouped by person.
- **Who the page is opened as**
  - `openagent/src/dashboard/rpc-serve.ts` `makeRpcMount` reads `x-openagent-person`. Only a well-formed account is taken.
  - It runs the handler inside an `AsyncLocalStorage` holding `{ person }`, through a new `requestPerson()` in `dashboard-rpc/context.ts`.
  - `onPerson` (`dashboard-rpc/person.ts`):
    - When `requestPerson()` names someone other than the owner (the git host's `login`), it answers `{ name: login, login, avatar: https://github.com/<login>.png }`.
    - It caches by login, not once for everyone.
  - `PersonMenu` then shows the invited person, unchanged.
- **The enter page** (`/_remote-access/enter`, `remote-access` door's page) says "You are in as @x on <name>" when the answer carries `person`.

### Checks

- Run `pnpm -r test` and `pnpm -r typecheck`.
- On a computer of one's own, check by hand:
  1. Invite "Me" and see nothing new.
  2. Invite "Someone else", confirm the owner, open the link in a private window, and see the sidebar name the invited person.
  3. Remove the person and see that window locked out.

## Later PRs, in short

- **PR 2:** `servers` provisions `oa-<login>` with its own OpenAgent service, port or socket, and home. The person's logins get there the way a server's do today, aimed at that user: `gh` copied over SSH or made with GitHub's code, and `claude setup-token`. The door's `passOn` picks the target by person. The server refuses the user when their `gh api user` is not the person.
- **PR 3:** daemons move to Unix sockets with mode 0600 (Solution 2). The door is the only thing that reaches every daemon. Another person's runs reach a person through `agent-data`, read only, as in #2138.
- **PR 4:** lines per person (Solution 4), with a "Who may use it: only me / everyone here" pick when a laptop connects.
- **PR 5:** the laptop's dashboard lists the computers a server holds lines to, under "Run on" in the server's group, and starts runs through the server's relay: laptop → server door → line → that computer.
