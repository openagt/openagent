import { extname } from 'node:path'

/**
 * Content types for the files OpenAgent's two static servers hand out — the dashboard
 * bundle (static.ts) and a project's on-demand Preview (preview.ts). One table so the two
 * cannot drift apart, which they had: each was missing extensions the other listed. The two
 * servers keep their own policies (SPA fallback + immutable cache vs 403 + stream); only this
 * lookup is shared. Unknown extensions fall back to `application/octet-stream`.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/** The content type for a file path (by its extension), or `application/octet-stream`. */
export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}
