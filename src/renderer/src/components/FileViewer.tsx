import { useEffect, useState } from 'react'
import type { Tab } from '@shared/types'
import { fileUrl, previewKind } from '@shared/fileKinds'
import { useStore } from '@/store'
import { basename, cleanError, downloadToPicked, REVEAL_LABEL } from '@/lib/util'
import { Icon } from './Icon'

/** "Open with default app": local files directly, server files as a downloaded copy. */
export async function openExternally(path: string, serverId?: string): Promise<void> {
  try {
    if (serverId) await window.orbit.remoteOpenExternal(serverId, path)
    else await window.orbit.openPath(path)
  } catch (e) {
    useStore.getState().notify(cleanError(e), 'error')
  }
}

function FileActions({ tab }: { tab: Tab }) {
  const path = tab.filePath!
  return (
    <>
      <button className="btn small-btn" onClick={() => openExternally(path, tab.serverId)}>
        <Icon name="window" size={12} /> Open with default app
      </button>
      {tab.serverId ? (
        <button className="btn small-btn" onClick={() => downloadToPicked(tab.serverId!, [{ path }]).catch((e) => useStore.getState().notify(cleanError(e), 'error'))}>
          <Icon name="arrow-down" size={12} /> Download…
        </button>
      ) : (
        <button className="btn small-btn" onClick={() => window.orbit.reveal(path)}>
          <Icon name="folder" size={12} /> {REVEAL_LABEL}
        </button>
      )}
    </>
  )
}

/** Shown instead of the editor for files it can't show (binary, too large, unreadable). */
export function FileFallback({ tab, message }: { tab: Tab; message: string }) {
  return (
    <div className="file-fallback">
      <Icon name="file" size={34} />
      <div className="file-fallback-name">{basename(tab.filePath ?? '')}</div>
      <p className="muted">{cleanError(message)}</p>
      <div className="file-fallback-actions">
        <FileActions tab={tab} />
      </div>
    </div>
  )
}

/** Images, PDFs, video and audio. Server files are copied to a local cache first. */
export function FileViewer({ tab }: { tab: Tab }) {
  const path = tab.filePath!
  const kind = previewKind(path)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [actual, setActual] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    if (tab.serverId)
      window.orbit.remoteCache(tab.serverId, path).then(
        (local) => live && setSrc(fileUrl(local, Date.now())),
        (e) => live && setError(cleanError(e))
      )
    else setSrc(fileUrl(path, version))
    return () => {
      live = false
    }
  }, [path, tab.serverId, version])

  // the file changed on disk (an agent re-rendered a screenshot, say): show the new one
  useEffect(() => {
    if (tab.serverId) return
    return window.orbit.onEvent((e) => {
      if (e.type === 'fs' && e.changes.some((c) => c.path === path)) setVersion((v) => v + 1)
    })
  }, [path, tab.serverId])

  if (error) return <FileFallback tab={tab} message={error} />

  return (
    <div className={`viewer viewer-${kind}`}>
      <div className="viewer-stage">
        {!src && <div className="pane-message">{tab.serverId ? 'Downloading…' : 'Loading…'}</div>}
        {src && kind === 'image' && (
          <div className={`viewer-image checker ${actual ? 'actual' : 'fit'}`} onClick={() => setActual(!actual)} title={actual ? 'Click to fit' : 'Click for actual size'}>
            <img src={src} alt={basename(path)} draggable={false} onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setError('This image could not be decoded')} />
          </div>
        )}
        {src && kind === 'pdf' && <iframe className="viewer-pdf" src={src} title={basename(path)} />}
        {src && kind === 'video' && <video className="viewer-video" src={src} controls onError={() => setError('This video format is not supported here')} />}
        {src && kind === 'audio' && (
          <div className="viewer-audio">
            <Icon name="music" size={40} />
            <div className="file-fallback-name">{basename(path)}</div>
            <audio src={src} controls onError={() => setError('This audio format is not supported here')} />
          </div>
        )}
      </div>
      <div className="viewer-bar">
        <span className="viewer-name" title={path}>{basename(path)}</span>
        {dims && <span className="muted">{dims.w} × {dims.h}</span>}
        <span className="grow" />
        {kind === 'image' && (
          <div className="segmented">
            <button className={!actual ? 'on' : ''} onClick={() => setActual(false)}>Fit</button>
            <button className={actual ? 'on' : ''} onClick={() => setActual(true)}>100%</button>
          </div>
        )}
        <button className="icon-btn" title="Reload" onClick={() => setVersion((v) => v + 1)}>
          <Icon name="refresh" />
        </button>
        <FileActions tab={tab} />
      </div>
    </div>
  )
}
