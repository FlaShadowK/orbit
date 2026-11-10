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

/** Agent status: a small dot. It breathes softly while working and turns amber when the agent needs you. */
export function StatusDot({ status, activity, label = true }: { status?: AgentStatus; activity?: AgentActivity; label?: boolean }) {
  if (!status) return null
  const title = status === 'working' ? ACTIVITY_LABEL[activity ?? 'thinking'] : LABEL[status]
  return (
    <span className={`agent-ind st-${status}`} title={title}>
      {status === 'waiting' && label && <span className="needs-you">Needs you</span>}
      <span className="status-dot" aria-label={title} />
    </span>
  )
}
