// Whether the extension's own files changed on disk (#1711). Shared by the service worker, which
// reloads the extension when they did, and the offline harness, which pins the rule; loaded as a
// plain script in both.
//
// This exists because the extension is unpacked and edited in place, and Chrome re-reads an
// unpacked extension's files only on a reload — which used to be a human click on
// chrome://extensions after every change. The worker can read its own files as they are on disk
// right now (measured 2026-08-26: a fetch of the extension's own URL returns the current file,
// not a cached copy), so it fingerprints them at start, again every beat, and reloads itself on
// a difference.

/** Every file Chrome loads for this extension: the manifest, the worker and what it imports, the content script, and the options page and its script. */
const WATCHED_FILES = ['manifest.json', 'background.js', 'driver-plan.js', 'fingerprint.js', 'content.js', 'options.html', 'options.js']

/** FNV-1a over the text, as eight hex digits. Enough to tell an edit; nobody is attacking it. */
function hashText(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The hash of each watched file, read through `readText(file)`. A file that cannot be read fails
 * the whole fingerprint rather than standing in as a change: a reload on a read that merely
 * failed this once would loop.
 */
async function fingerprint(readText) {
  const hashes = {}
  for (const file of WATCHED_FILES) hashes[file] = hashText(await readText(file))
  return hashes
}

/** The watched files whose hash differs between two fingerprints, in watched order. */
function changedFiles(before, after) {
  return WATCHED_FILES.filter(file => before[file] !== after[file])
}

// The worker loads this with importScripts, where a top-level binding is already global; jsdom
// evaluates it the same way. Nothing else to export.
if (typeof globalThis !== 'undefined') globalThis.__oaFingerprint = { WATCHED_FILES, fingerprint, changedFiles }
