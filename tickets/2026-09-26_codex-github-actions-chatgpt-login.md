Topics: drivers, codex, github-actions
Issue: [#1861](https://github.com/openagt/openagent/issues/1861)

# Codex on GitHub Actions needs a way to keep a ChatGPT login

## TLDR

`@agent-driver/github-actions` runs Claude Code. Adding Codex is small on the driver side (one workflow step and Codex's output reader); the blocker is the login. `openai/codex-action` takes only an API key (breaks "your subscription, never a key"). OpenAI's advanced CI route copies a ChatGPT login's `auth.json` to the runner and keeps the refreshed file — but GitHub-hosted runners start fresh, so the refreshed login would have to be written back (e.g. into a secret) after every run, and reusing a laptop's login can log the laptop out. Codex has no equivalent of `claude setup-token`.

Worth building when one of: a self-hosted runner (Codex home stays on disk); a separate ChatGPT login used only for CI with the refreshed file saved back after each run; or OpenAI shipping a CI token.

Links: [openai/codex-action](https://github.com/openai/codex-action), [Maintain Codex account auth in CI/CD](https://developers.openai.com/codex/auth/ci-cd-auth), [Codex authentication](https://learn.chatgpt.com/docs/auth)

## Why it matters

Codex users should be able to run agents on GitHub Actions with their subscription, as Claude users can.
