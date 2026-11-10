import { useShallow } from 'zustand/react/shallow'
import { useEffect, useState } from 'react'
import type { AuthMethod, BeszelSystemRef, Server, ServerInput } from '@shared/types'
import { useStore } from '@/store'
import { SPACE_COLORS } from '@/lib/util'

const EMPTY: ServerInput = { name: '', host: '', port: 22, username: 'root', auth: 'agent', tags: [], color: SPACE_COLORS[1] }

export function ServerModal() {
  const { serverModal, servers, set, notify } = useStore(useShallow((s) => ({ serverModal: s.serverModal, servers: s.servers, set: s.set, notify: s.notify })))
  const editing: Server | undefined = serverModal?.mode === 'edit' ? serverModal.server : undefined
  const [form, setForm] = useState<ServerInput>(EMPTY)
  const [secretFlags, setSecretFlags] = useState({ password: false, privateKey: false, passphrase: false, beszelPassword: false })
  const [beszelOn, setBeszelOn] = useState(false)
  const [beszelPassword, setBeszelPassword] = useState('')
  const [systems, setSystems] = useState<BeszelSystemRef[] | null>(null)
  const [beszelMsg, setBeszelMsg] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [tags, setTags] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!serverModal) return
    setForm(editing ? { ...editing } : { ...EMPTY, color: SPACE_COLORS[(servers.length + 1) % SPACE_COLORS.length] })
    setTags(editing?.tags.join(', ') ?? '')
    setPassword('')
    setPrivateKey('')
    setPassphrase('')
    setTesting(null)
    setBeszelOn(!!editing?.beszel)
    setBeszelPassword('')
    setSystems(null)
    setBeszelMsg(null)
    if (editing) window.orbit.serverSecretFlags(editing.id).then(setSecretFlags)
    else setSecretFlags({ password: false, privateKey: false, passphrase: false, beszelPassword: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverModal])

  if (!serverModal) return null
  const close = (): void => set({ serverModal: null })
  const upd = (patch: Partial<ServerInput>): void => setForm((f) => ({ ...f, ...patch }))
  const updBeszel = (patch: Partial<NonNullable<ServerInput['beszel']>>): void =>
    setForm((f) => ({ ...f, beszel: { url: '', email: '', ...f.beszel, ...patch } }))

  /** sign in to the hub and list its systems; pick the one matching this server when obvious */
  const connectBeszel = async (): Promise<void> => {
    setBeszelMsg('Connecting…')
    try {
      const list = await window.orbit.beszelSystems(editing?.id, { url: form.beszel?.url ?? '', email: form.beszel?.email ?? '', password: beszelPassword })
      setSystems(list)
      const guess =
        list.find((x) => x.id === form.beszel?.systemId) ??
        list.find((x) => [form.name, form.host].some((v) => v && (x.name === v || x.host === v))) ??
        (list.length === 1 ? list[0] : undefined)
      if (guess) updBeszel({ systemId: guess.id, systemName: guess.name })
      setBeszelMsg(list.length ? `✓ Connected — ${list.length} system${list.length === 1 ? '' : 's'}` : '✗ This account cannot see any systems')
    } catch (e) {
      setBeszelMsg(`✗ ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    }
  }

  const save = async (test = false): Promise<Server | undefined> => {
    if (!form.host.trim() || !form.username.trim()) {
      notify('Host and user are required', 'error')
      return
    }
    setBusy(true)
    try {
      const saved = await window.orbit.saveServer({
        ...form,
        name: form.name.trim() || form.host.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 22,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        beszel: beszelOn && form.beszel?.url ? form.beszel : undefined,
        secret: { password, privateKey, passphrase, beszelPassword }
      })
      set({ servers: await window.orbit.listServers(), serverModal: { mode: 'edit', server: saved } })
      if (test) {
        setTesting('Connecting…')
        try {
          const out = await window.orbit.testServer(saved.id)
          setTesting(`✓ Connected — ${out}`)
        } catch (e) {
          setTesting(`✗ ${(e as Error).message.replace(/^Error invoking remote method '[^']+': /, '')}`)
        }
      }
      return saved
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{editing ? `Edit ${editing.name}` : 'Add server'}</h2>
        <div className="form-grid">
          <label>
            Name
            <input value={form.name} placeholder="prod-api" onChange={(e) => upd({ name: e.target.value })} autoFocus />
          </label>
          <label className="color-field">
            Color
            <div className="swatches">
              {SPACE_COLORS.map((c) => (
                <button key={c} className={`swatch ${form.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => upd({ color: c })} />
              ))}
            </div>
          </label>
          <label className="span2-left">
            Host
            <input value={form.host} placeholder="203.0.113.10 or example.com" onChange={(e) => upd({ host: e.target.value })} />
          </label>
          <label>
            Port
            <input type="number" value={form.port} onChange={(e) => upd({ port: Number(e.target.value) })} />
          </label>
          <label>
            User
            <input value={form.username} onChange={(e) => upd({ username: e.target.value })} />
          </label>
          <label>
            Auth
            <select value={form.auth} onChange={(e) => upd({ auth: e.target.value as AuthMethod })}>
              <option value="agent">SSH agent / default keys</option>
              <option value="key">Private key</option>
              <option value="password">Password</option>
            </select>
          </label>

          {form.auth === 'password' && (
            <label className="span2">
              Password {secretFlags.password && <span className="muted">(saved — leave empty to keep)</span>}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          {form.auth === 'key' && (
            <>
              <label className="span2">
                Key file
                <div className="input-row">
                  <input value={form.keyPath ?? ''} placeholder="~/.ssh/id_ed25519" onChange={(e) => upd({ keyPath: e.target.value })} />
                  <button
                    className="btn"
                    onClick={async () => {
                      const f = await window.orbit.pickFile()
                      if (f) upd({ keyPath: f })
                    }}
                  >
                    Browse
                  </button>
                </div>
              </label>
              <label className="span2">
                …or paste private key {secretFlags.privateKey && <span className="muted">(saved — leave empty to keep)</span>}
                <textarea rows={3} value={privateKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" onChange={(e) => setPrivateKey(e.target.value)} />
              </label>
              <label className="span2">
                Passphrase {secretFlags.passphrase && <span className="muted">(saved)</span>}
                <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </label>
            </>
          )}

          <label>
            Jump host
            <select value={form.jumpServerId ?? ''} onChange={(e) => upd({ jumpServerId: e.target.value || undefined })}>
              <option value="">None</option>
              {servers.filter((s) => s.id !== editing?.id).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Default directory
            <input value={form.defaultDir ?? ''} placeholder="/var/www/app" onChange={(e) => upd({ defaultDir: e.target.value || undefined })} />
          </label>
          <label className="span2">
            Tags <span className="muted">(comma separated)</span>
            <input value={tags} placeholder="production, docker" onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="span2">
            Notes for agents
            <textarea rows={2} value={form.notes ?? ''} placeholder="e.g. Runs docker compose in /srv/app, nginx reverse proxy, deploy via git pull" onChange={(e) => upd({ notes: e.target.value || undefined })} />
          </label>
          <div className="span2 beszel-box">
            <label className="check-row beszel-toggle">
              <input type="checkbox" checked={beszelOn} onChange={(e) => setBeszelOn(e.target.checked)} />
              <span className="beszel-title">Live stats from Beszel</span>
              <span className="muted">· shows CPU, memory, disk and more under the server</span>
            </label>
            {beszelOn && (
              <div className="beszel-fields">
                <label className="span2">
                  Hub URL
                  <input value={form.beszel?.url ?? ''} placeholder="https://beszel.example.com" onChange={(e) => updBeszel({ url: e.target.value })} />
                </label>
                <label>
                  Email
                  <input value={form.beszel?.email ?? ''} placeholder="you@example.com" onChange={(e) => updBeszel({ email: e.target.value })} />
                </label>
                <label>
                  Password {secretFlags.beszelPassword && <span className="muted">(saved)</span>}
                  <input type="password" value={beszelPassword} onChange={(e) => setBeszelPassword(e.target.value)} />
                </label>
                <div className="span2 beszel-connect">
                  <button className="btn" onClick={connectBeszel} disabled={!form.beszel?.url || !form.beszel?.email || (!beszelPassword && !secretFlags.beszelPassword)}>
                    Connect
                  </button>
                  {systems && systems.length > 0 && (
                    <select
                      value={form.beszel?.systemId ?? ''}
                      onChange={(e) => {
                        const x = systems.find((y) => y.id === e.target.value)
                        updBeszel({ systemId: x?.id, systemName: x?.name })
                      }}
                    >
                      <option value="">Choose the system for this server…</option>
                      {systems.map((x) => (
                        <option key={x.id} value={x.id}>{x.name} ({x.status})</option>
                      ))}
                    </select>
                  )}
                  {!systems && form.beszel?.systemName && <span className="muted small">System: {form.beszel.systemName}</span>}
                </div>
                {beszelMsg && <div className={`span2 test-result ${beszelMsg.startsWith('✓') ? 'ok' : beszelMsg.startsWith('✗') ? 'bad' : ''}`}>{beszelMsg}</div>}
              </div>
            )}
          </div>
        </div>
        {testing && <div className={`test-result ${testing.startsWith('✓') ? 'ok' : testing.startsWith('✗') ? 'bad' : ''}`}>{testing}</div>}
        <div className="modal-actions">
          {editing && (
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm(`Remove server "${editing.name}"?`)) return
                await window.orbit.removeServer(editing.id)
                set({ servers: await window.orbit.listServers(), serverModal: null })
              }}
            >
              Remove
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn" disabled={busy} onClick={() => save(true)}>Save & test</button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              if (await save()) close()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
