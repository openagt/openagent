/**
 * OpenAgent's version, as the package that started the dashboard says it (`@openagt/start`, the
 * one people install, through `runDaemon`'s `version`): what this computer tells the machines
 * it gets into and a phone. `unknown` until said: the packages are unreleased and legitimately
 * versioned `0.0.0`, so a numeric stand-in would read as a real version (#312).
 */
let version = 'unknown'

export function openagentVersion(): string {
  return version
}

export function setOpenagentVersion(said: string): void {
  version = said
}
