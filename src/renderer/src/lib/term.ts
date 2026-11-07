// Single IPC listener fan-out for terminal data/exit, keyed by session id.
type DataCb = (data: string) => void
type ExitCb = (code: number | null) => void
const dataSubs = new Map<string, DataCb>()
const exitSubs = new Map<string, ExitCb>()

window.orbit.onTermData((id, data) => dataSubs.get(id)?.(data))
window.orbit.onTermExit((id, code) => exitSubs.get(id)?.(code))

export function subscribeTerm(id: string, onData: DataCb, onExit: ExitCb): () => void {
  dataSubs.set(id, onData)
  exitSubs.set(id, onExit)
  return () => {
    if (dataSubs.get(id) === onData) dataSubs.delete(id)
    if (exitSubs.get(id) === onExit) exitSubs.delete(id)
  }
}
