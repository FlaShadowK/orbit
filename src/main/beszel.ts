/**
 * Read-only client for a Beszel hub (PocketBase REST API).
 * Requests go out from the main process so the hub needs no CORS setup and the password
 * never reaches the renderer.
 */
import { net } from 'electron'
import { createHash } from 'crypto'
import type { BeszelSnapshot, BeszelSystemRef, StatRange } from '@shared/types'
import { store } from './store'
import { RANGE, toSnapshot, type RawContainer, type RawStatRecord, type RawSystem } from './beszelData'

interface Creds {
  url: string
  email: string
  password: string
}

/** auth token per hub+email; PocketBase tokens last days, we re-auth on 401 */
const tokens = new Map<string, string>()
// the password is part of the key so a changed (or wrong) password never reuses an old session
const keyOf = (c: Creds): string => `${c.url}\n${c.email}\n${createHash('sha256').update(c.password).digest('hex')}`

export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`
  return u
}

/** fetch with network failures turned into something a user can act on */
async function fetchHub(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await net.fetch(url, init)
  } catch (e) {
    const msg = (e as Error).message
    if (/SSL|CERT/i.test(msg)) throw new Error(`Secure connection to ${new URL(url).host} failed — check the hub URL (http:// vs https://)`)
    if (/NAME_NOT_RESOLVED/.test(msg)) throw new Error(`Can't find ${new URL(url).host} — check the hub URL`)
    if (/CONNECTION_REFUSED|TIMED_OUT|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED/.test(msg)) throw new Error(`Can't reach the Beszel hub at ${new URL(url).host}`)
    throw e
  }
}

async function auth(c: Creds): Promise<string> {
  const res = await fetchHub(`${c.url}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: c.email, password: c.password })
  })
  if (res.status === 400) throw new Error('Wrong Beszel email or password')
  if (!res.ok) throw new Error(`Beszel hub returned ${res.status}`)
  const token = ((await res.json()) as { token: string }).token
  tokens.set(keyOf(c), token)
  return token
}

async function get<T>(c: Creds, path: string): Promise<T> {
  let token = tokens.get(keyOf(c)) ?? (await auth(c))
  let res = await fetchHub(`${c.url}${path}`, { headers: { Authorization: token } })
  if (res.status === 401 || res.status === 403) {
    token = await auth(c)
    res = await fetchHub(`${c.url}${path}`, { headers: { Authorization: token } })
  }
  if (!res.ok) throw new Error(`Beszel hub returned ${res.status} for ${path.split('?')[0]}`)
  return (await res.json()) as T
}

const q = (filter: string): string => encodeURIComponent(filter)

function credsFor(serverId: string, override?: Partial<Creds>): Creds {
  const server = store.getServer(serverId)
  const url = normalizeUrl(override?.url ?? server?.beszel?.url ?? '')
  const email = (override?.email ?? server?.beszel?.email ?? '').trim()
  const password = override?.password || store.getSecret(serverId).beszelPassword || ''
  if (!url || !email || !password) throw new Error('Beszel hub URL, email and password are required')
  return { url, email, password }
}

/** Systems the account can see (for picking which one belongs to this server). */
export async function listSystems(serverId: string | undefined, override: Partial<Creds>): Promise<BeszelSystemRef[]> {
  const c = serverId ? credsFor(serverId, override) : credsFor('', override)
  await auth(c) // "Connect" must prove these credentials work, not reuse a cached session
  const r = await get<{ items: RawSystem[] }>(c, '/api/collections/systems/records?perPage=200&sort=name&fields=id,name,host,status')
  return r.items.map((s) => ({ id: s.id, name: s.name, host: s.host, status: s.status }))
}

const cache = new Map<string, { at: number; snap: BeszelSnapshot }>()
const CACHE_MS = 15_000

export async function snapshot(serverId: string, range: StatRange = '1h'): Promise<BeszelSnapshot> {
  const key = `${serverId}:${range}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.snap
  const server = store.getServer(serverId)
  const systemId = server?.beszel?.systemId
  if (!systemId) throw new Error('No Beszel system selected for this server')
  const c = credsFor(serverId)
  const { type, points } = RANGE[range]
  const [sys, stats, containers] = await Promise.all([
    get<RawSystem>(c, `/api/collections/systems/records/${encodeURIComponent(systemId)}`),
    get<{ items: RawStatRecord[] }>(
      c,
      `/api/collections/system_stats/records?perPage=${points}&sort=-created&fields=created,stats&filter=${q(`system='${systemId}' && type='${type}'`)}`
    ),
    get<{ items: { stats: RawContainer[] }[] }>(
      c,
      `/api/collections/container_stats/records?perPage=1&sort=-created&fields=stats&filter=${q(`system='${systemId}' && type='1m'`)}`
    ).catch(() => ({ items: [] }))
  ])
  const snap = toSnapshot(sys, stats.items, containers.items[0]?.stats ?? [])
  cache.set(key, { at: Date.now(), snap })
  return snap
}

/** Forget cached data/tokens after the server's Beszel settings change. */
export function invalidate(serverId: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(`${serverId}:`)) cache.delete(k)
}
