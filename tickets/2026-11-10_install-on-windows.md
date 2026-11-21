Topics: [install, windows]
Issue: [#2361](https://github.com/openagt/openagent/issues/2361)

# `npx @openagt/install` on Windows

## TLDR

`npx @openagt/install` works on a Mac and on Linux; on Windows it stops and tells the person to run `npx @openagt/dashboard` instead. Windows needs the same install: the dashboard starting at each login with no terminal open, `https://openagent.build` opening the person's own dashboard (a hosts line, a certificate made on the computer and trusted by its browsers, port 443 on a loopback address of its own), and `npx @openagt/uninstall` taking all of it off again.

## Why it matters

Windows users get no installed OpenAgent today: no dashboard at login, no `https://openagent.build`.

## In the code

- `packages/install` runs the same steps on every system through one `Platform` (`platform.ts`), with `mac.ts` and `linux.ts`; Windows needs a `windows.ts` with the same parts.
- To find on Windows: start at login (a scheduled task or a Startup entry), writing the hosts file and the certificate store as administrator (one UAC prompt), and Firefox's own certificate store.

## Comes first

Not checked yet: whether the dashboard itself, its runs and its scheduler work on Windows without WSL. That comes first: the install is only worth building on a dashboard that works there.
