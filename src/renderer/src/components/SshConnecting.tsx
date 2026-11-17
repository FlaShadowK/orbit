import { useEffect, useState } from 'react'
import type { SshStage } from '@shared/types'
import { useStore } from '@/store'
import { Icon } from './Icon'

export interface ConnState {
  stage: SshStage | 'error'
  since: number
  error?: string
}

const STEPS: { id: SshStage; label: string }[] = [
  { id: 'jump', label: 'Jump host' },
  { id: 'connecting', label: 'Connect' },
  { id: 'handshake', label: 'Handshake' },
  { id: 'auth', label: 'Authenticate' },
  { id: 'shell', label: 'Shell' }
]

/** Errors from ssh2 / the OS, put in words people recognise. */
function explain(raw: string): string {
  const msg = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  if (/All configured authentication methods failed/i.test(msg)) return 'The server rejected the login. Check the user, key or password.'
  if (/ECONNREFUSED/.test(msg)) return 'Connection refused: nothing is listening on that port.'
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Host not found. Check the address or your DNS.'
  if (/ETIMEDOUT|Timed out while waiting for handshake/i.test(msg)) return 'The server did not answer in time.'
  if (/EHOSTUNREACH|ENETUNREACH/.test(msg)) return 'The host is unreachable from this network.'
  return msg
}

/** Shown over an SSH tab while it connects: each step lights up as it completes, like a boarding pass. */
export function SshConnecting({ serverId, state, onRetry, onDismiss }: { serverId: string; state: ConnState; onRetry: () => void; onDismiss: () => void }) {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId))
  const jump = useStore((s) => s.servers.find((x) => x.id === server?.jumpServerId))
  const [now, setNow] = useState(Date.now())
  const failed = state.stage === 'error'

  useEffect(() => {
    if (failed) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [failed])

  if (!server) return null
  const steps = STEPS.filter((s) => s.id !== 'jump' || jump)
  const current = failed ? -1 : steps.findIndex((s) => s.id === state.stage)
  const secs = Math.max(0, (now - state.since) / 1000)
  const text: Record<SshStage, string> = {
    jump: `Connecting through ${jump?.name ?? 'jump host'}…`,
    connecting: `Connecting to ${server.host}:${server.port || 22}…`,
    handshake: 'Negotiating encryption…',
    auth: `Authenticating as ${server.username}…`,
    shell: 'Opening a shell…'
  }

  return (
    <div className={`ssh-connect ${failed ? 'failed' : ''}`}>
      <div className="ssh-card" style={{ ['--srv' as string]: server.color }}>
        <div className="ssh-badge">
          <Icon name="server" size={22} />
          {!failed && <span className="ssh-ring" />}
        </div>
        <div className="ssh-name">{server.name}</div>
        <div className="ssh-host">{server.username}@{server.host}:{server.port || 22}</div>
        {failed ? (
          <>
            <div className="ssh-error">
              <Icon name="x" size={13} /> Couldn't connect
            </div>
            <p className="ssh-error-msg">{explain(state.error ?? '')}</p>
            <div className="ssh-actions">
              <button className="btn primary" onClick={onRetry}>
                <Icon name="refresh" size={13} /> Retry
              </button>
              <button className="btn" onClick={() => useStore.getState().set({ serverModal: { mode: 'edit', server } })}>
                Edit server
              </button>
              <button className="btn ghost-btn" onClick={onDismiss}>Show terminal</button>
            </div>
          </>
        ) : (
          <>
            <ol className="ssh-steps">
              {steps.map((s, i) => (
                <li key={s.id} className={i < current ? 'done' : i === current ? 'now' : ''}>
                  <span className="ssh-step-dot">{i < current && <Icon name="check" size={9} />}</span>
                  <span className="ssh-step-label">{s.label}</span>
                </li>
              ))}
            </ol>
            <div className="ssh-status">
              <span>{text[state.stage as SshStage]}</span>
              <span className="ssh-time">{secs.toFixed(1)}s</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
