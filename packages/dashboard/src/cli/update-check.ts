/**
 * CLI "up-to-date?" check (#312): after the bare-`openagent` version footer,
 * tell the user whether a newer version is published on npm. Display only;
 * auto-update is a separate, deferred concern. Same seam + node-adapter +
 * forgiving-on-error convention as `project.ts` (#380).
 */

/** The npm package this CLI ships as; the registry key for the version check. */
export const PACKAGE_NAME = '@openagt/dashboard'

/** Fetches the latest published version of `pkg`, or undefined on any failure. Injectable for tests. */
export type VersionFetcher = (pkg: string) => Promise<string | undefined>

/**
 * A {@link VersionFetcher} backed by the npm registry. GETs the packument and
 * reads `dist-tags.latest`. A 2.5s AbortSignal.timeout caps it; any error /
 * non-ok / offline yields undefined (the check silently degrades to "unknown").
 */
export function nodeVersionFetcher(): VersionFetcher {
  return async pkg => {
    try {
      const res = await fetch(`https://registry.npmjs.org/${pkg}`, { signal: AbortSignal.timeout(2500) })
      if (!res.ok) return undefined
      const data = (await res.json()) as { 'dist-tags'?: { latest?: unknown } } | undefined
      const latest = data?.['dist-tags']?.latest
      return typeof latest === 'string' ? latest : undefined
    } catch {
      return undefined
    }
  }
}

/** The result of an update check. */
export type UpdateStatus =
  | { kind: 'up-to-date'; current: string }
  | { kind: 'update-available'; current: string; latest: string }
  | { kind: 'unknown'; current: string } // offline / fetch failed

/**
 * Compare two `major.minor.patch` versions numerically (a prerelease/build
 * suffix after `-` or `+` is stripped, missing parts read as 0). Returns
 * -1 / 0 / 1. No semver dependency.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    (v.split(/[-+]/)[0] ?? '').split('.').map(n => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na < nb ? -1 : 1
  }
  return 0
}

/**
 * Check whether `current` is behind the latest published version. Uses the
 * injected fetcher; a missing/failed fetch is 'unknown'. `current` >= latest is
 * 'up-to-date' (so running a local build ahead of the registry never reads as
 * "update available").
 */
export async function checkForUpdate(
  current: string,
  fetchLatest: VersionFetcher,
  pkg: string = PACKAGE_NAME,
): Promise<UpdateStatus> {
  const latest = await fetchLatest(pkg)
  if (!latest) return { kind: 'unknown', current }
  return compareVersions(latest, current) > 0
    ? { kind: 'update-available', current, latest }
    : { kind: 'up-to-date', current }
}

/** The one-line message to print for a status, or undefined for 'unknown' (print nothing). */
export function formatUpdateStatus(status: UpdateStatus): string | undefined {
  switch (status.kind) {
    case 'up-to-date':
      return `✅ Up to date (v${status.current})`
    case 'update-available':
      return `⬆️  Update available: v${status.latest} (you have v${status.current}). Run: npm i -g ${PACKAGE_NAME}`
    case 'unknown':
      return undefined
  }
}
