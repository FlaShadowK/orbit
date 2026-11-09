import { useEffect, useRef } from 'react'
import type { AgentActivity, AgentStatus } from '@shared/types'

const LABEL: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Needs your input',
  done: 'Finished',
  exited: 'Exited'
}

const ACTIVITY_LABEL: Record<AgentActivity, string> = {
  streaming: 'Working · writing output',
  thinking: 'Working · thinking',
  deep: 'Working · thinking hard'
}

/** orbits per second, relative to a 1s base loop */
const SPEED: Record<AgentActivity, number> = { streaming: 1.6, thinking: 0.5, deep: 0.22 }

/**
 * Agent status. A dot while idle / waiting / done; while working it grows into the Orbit
 * planet with a satellite whose speed follows what the agent is doing.
 */
export function StatusDot({ status, activity, label = true }: { status?: AgentStatus; activity?: AgentActivity; label?: boolean }) {
  const sat = useRef<HTMLSpanElement>(null)
  const orbit = useRef<Animation | null>(null)
  const working = status === 'working'
  const act: AgentActivity = activity ?? 'thinking'

  // one endless orbit animation per indicator; speed changes go through playbackRate so they glide
  useEffect(() => {
    const el = sat.current
    if (!el || typeof el.animate !== 'function') return
    orbit.current = el.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], { duration: 1000, iterations: Infinity })
    orbit.current.pause()
    return () => orbit.current?.cancel()
  }, [status !== undefined])

  useEffect(() => {
    const a = orbit.current
    if (!a) return
    if (!working) {
      a.pause()
      return
    }
    a.play()
    a.updatePlaybackRate(SPEED[act])
  }, [working, act])

  if (!status) return null
  return (
    <span className={`agent-ind st-${status} act-${working ? act : 'none'}`} title={working ? ACTIVITY_LABEL[act] : LABEL[status]}>
      {status === 'waiting' && label && <span className="needs-you">Needs you!</span>}
      <span className="orb" aria-hidden>
        <span className="orb-ring" />
        <span className="orb-planet" />
        <span className="orb-track">
          <span className="orb-sat" ref={sat} />
        </span>
      </span>
    </span>
  )
}
