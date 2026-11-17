/** Files Orbit shows in a viewer instead of the text editor. */
export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio'

const KINDS: Record<string, PreviewKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', ico: 'image', bmp: 'image', apng: 'image',
  pdf: 'pdf',
  mp4: 'video', m4v: 'video', webm: 'video', mov: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', opus: 'audio'
}

export const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', bmp: 'image/bmp', apng: 'image/apng', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg'
}

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function previewKind(path?: string): PreviewKind | null {
  return path ? (KINDS[extOf(path)] ?? null) : null
}

export function mimeFor(path: string): string {
  return MIME[extOf(path)] ?? 'application/octet-stream'
}

/** Local files are served to the renderer through this scheme (the page can't load file: URLs). */
export const FILE_SCHEME = 'orbit-file'

export function fileUrl(path: string, version?: number | string): string {
  return `${FILE_SCHEME}://local/${encodeURIComponent(path)}${version != null ? `?v=${version}` : ''}`
}

/** Inverse of fileUrl (main process). */
export function pathFromFileUrl(url: string): string {
  const u = new URL(url)
  return decodeURIComponent(u.pathname.replace(/^\//, ''))
}
