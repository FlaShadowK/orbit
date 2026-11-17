import { protocol } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import { FILE_SCHEME, mimeFor, pathFromFileUrl } from '@shared/fileKinds'

/** Must run before the app is ready. */
export function registerFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

const body = (path: string, opts?: { start: number; end: number }): ReadableStream =>
  Readable.toWeb(createReadStream(path, opts)) as unknown as ReadableStream

/**
 * Serves local files to the viewer (images, PDF, audio, video). Range requests are answered so
 * video can seek. The renderer can already read any file over IPC, so this adds no new access.
 */
export function handleFileScheme(): void {
  protocol.handle(FILE_SCHEME, async (req) => {
    let path: string
    try {
      path = pathFromFileUrl(req.url)
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    const st = await fs.stat(path).catch(() => null)
    if (!st?.isFile()) return new Response('Not found', { status: 404 })
    const type = mimeFor(path)
    const m = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/)
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]))
      const end = Math.min(m[1] && m[2] ? Number(m[2]) : st.size - 1, st.size - 1)
      if (start >= st.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } })
      return new Response(body(path, { start, end }), {
        status: 206,
        headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' }
      })
    }
    return new Response(body(path), {
      headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
    })
  })
}
