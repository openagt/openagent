---
name: browser
description: A real browser you drive from the shell, to see or act on a web page (open it, read it, click, type, take a screenshot), such as checking that the app you changed works.
metadata:
  version: 0.1.2
---

# The browser

A headless Chrome of your own, on an empty profile: nobody's logins are in it. Drive it with the `browser` command, always run by its full name: `npx @openagt/skill-browser@0.1`. It needs Chrome on the machine, or `CHROME_PATH` set to a Chrome or Chromium executable.

```
npx @openagt/skill-browser@0.1 open <address>       open the address, starting the browser if none is open
npx @openagt/skill-browser@0.1 read                 print the page again
npx @openagt/skill-browser@0.1 click <n>            click element n
npx @openagt/skill-browser@0.1 type <n> <text>      replace what element n holds with the text; on a select, pick that option;
                                                    on a date or time field, give the value as 2024-01-31, 13:45, 2024-01
npx @openagt/skill-browser@0.1 press <key>          Enter, Tab, Escape, Backspace, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight
npx @openagt/skill-browser@0.1 screenshot [file]    save what the page shows as a PNG and print its path (a temporary file
                                                    when none is named; never name one inside the repository)
npx @openagt/skill-browser@0.1 eval <script>        run a JavaScript expression in the page and print its value, as JSON
                                                    (`document.title`, not `return document.title`; `await` works; an
                                                    element prints as `{}`, so ask for its properties)
npx @openagt/skill-browser@0.1 console              print the browser's console since it opened: what the pages' code logged,
                                                    their uncaught errors and the files that did not load
npx @openagt/skill-browser@0.1 close                close the browser
```

Quote a `<text>` or `<script>` with spaces as one argument: `npx @openagt/skill-browser@0.1 type 2 'Ada Lovelace'`.

`open`, `read`, `click`, `type` and `press` print the page once it has loaded (or after 10 seconds, as it stands): its title, its address, its text (the first 10,000 characters), then its elements (links, buttons, fields; the first 300) numbered `[n]`. What is inside an iframe or a shadow root is not printed; reach it with `eval`. `click` and `type` take that number, from the last print: when the page changes, the numbers do too. The numbers are written on the page's elements as `data-browser-ref` attributes. An address without `http://` or `https://` gets `http://`; no other kind opens. A dialog the page opens (alert, confirm, prompt) is accepted at once, and the next print begins with a `Dialog, accepted:` line naming it. When the page logged errors since you were last told, the print begins with a `Console: 2 new errors.` line: read them with `console`. Each of its lines has its time, and a `→ <address>` line marks where the page went to another address, so what is under the last one is the page you are on. When not everything fits, the errors are printed first, then the newest lines. What a worker, or a frame from another site, logs is not in it.

The browser belongs to the project the command runs in (its git root): run every command from inside the same project.

A refusal exits 1 with the reason on stderr (no browser open, no such element, an address the server did not answer, a page that did not answer within 30 seconds; an error page such as a 404 prints like any page); a wrong command line exits 2 with the usage.

A person watching your run sees this browser live, with its console, and can click, type and paste in it too: if the page is not what your last print showed, read it again.

What a page asks of a person is theirs to give, not yours to get around: a sign-in, a "prove you are a human" check, a code from their phone, a card number. Never type someone's password, and never try to get past a check that is there to tell a person from a program. Say what the page is asking for, and ask the person for it (the `question` skill), ending your reply there. Your browser stays open while you wait and they do it themselves in the live view; their answer brings you back, and you read the page again and go on from where they left it. When nobody will answer you, say which page needs a person and stop there.

Close it when the page is of no more use to anyone (with none open, `close` says so and succeeds) — but leave it open when the person may want to see what you saw: the browser is their view as much as your tool, and the end of your run is when they are most likely to look. Left open, it closes itself 10 minutes after your run ends, longer while someone is still watching it, and after 30 minutes unused while your run is still going. A run that stops to ask a question keeps it for the answer.
