import type { AgentStatus } from '@shared/types'

const LABEL: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Needs input',
  done: 'Finished',
  exited: 'Exited'
}

export function StatusDot({ status }: { status?: AgentStatus }) {
  if (!status) return null
  return <span className={`status-dot s-${status}`} title={LABEL[status]} />
}
