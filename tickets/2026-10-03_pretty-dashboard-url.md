Topics: UX, dashboard, landing-page
Issue: [#1919](https://github.com/openagt/openagent/issues/1919)

# Pretty Dashboard URL

## TLDR

`openagent.build` serves both the landing page and the dashboard at the one URL, which never changes with what is shown. It shows the dashboard whenever one is available, the landing page otherwise. Below the top-left `[Logo] The Framework` logo sits a toggle, `Landing Page | Dashboard`, to switch between the two. The landing page also shows a big "Dashboard" call-to-action button.

## Why it matters

The dashboard gets a short, memorable address: a person types `openagent.build` and lands on their dashboard, with the landing page still one click away.

## Notes

- The issue has a mockup of the toggle under the logo.
- The author calls the proposal settled for them, with feedback welcome.

## Counter-proposal (issue comment, 2026-10-10)

Keeping `openagent.build` in the address bar while it shows the local dashboard has a price:

- Safari blocks it: a website page cannot read from `localhost` (tested on Safari 26.5: blocked, with nothing to allow).
- Chrome and Firefox ask first: "Allow openagent.build to connect to apps on this device?"
- The website could then start agents on every user's machine: if the site is ever taken over, so is every user.

Suggested instead: keep the toggle and the "Dashboard" button, but the button sends the browser to the dashboard's own address (`localhost:4200`, or the VPS on a phone). It works in every browser, asks nothing, and the website never touches the machine; the address bar changes after the click. For a nicer address, a DNS record could point `my.openagent.build` at "this computer" so the button goes to `my.openagent.build:4200`, at the price of plain HTTP ("Not secure", a few browser features off) and some home routers blocking such names.

The issue's author has not answered yet: which way to go is open. Full conversation: https://gist.github.com/suleimansh/189c9fc3899534e6f072245d5de9e270
