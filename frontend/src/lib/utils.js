export function statusBadge(state) {
  const map = {
    running: 'bg-green-500/20 text-green-400',
    RUNNING: 'bg-green-500/20 text-green-400',
    stopped: 'bg-red-500/20 text-red-400',
    STOPPED: 'bg-red-500/20 text-red-400',
    active:  'bg-blue-500/20 text-blue-400',
    PRIMARY: 'bg-blue-500/20 text-blue-400',
    standby: 'bg-gray-500/20 text-gray-400',
    STANDBY: 'bg-gray-500/20 text-gray-400',
    FAULT:   'bg-red-500/20 text-red-400',
    fault:   'bg-red-500/20 text-red-400',
    COMPLETED:   'bg-green-500/20 text-green-400',
    IN_PROGRESS: 'bg-blue-500/20 text-blue-400',
    SCHEDULED:   'bg-yellow-500/20 text-yellow-400',
    CRITICAL: 'bg-red-500/20 text-red-400',
    WARNING:  'bg-yellow-500/20 text-yellow-400',
    INFO:     'bg-blue-500/20 text-blue-400',
    READY:    'bg-green-500/20 text-green-400',
    GENERATING: 'bg-yellow-500/20 text-yellow-400',
    online:  'bg-green-500/20 text-green-400',
    offline: 'bg-red-500/20 text-red-400',
  }
  return `text-xs px-2 py-0.5 rounded-full font-medium ${map[state] ?? 'bg-gray-500/20 text-gray-400'}`
}

export function dot(state) {
  const map = {
    running: 'text-green-400', RUNNING: 'text-green-400',
    stopped: 'text-red-400',   STOPPED: 'text-red-400',
    active:  'text-blue-400',  PRIMARY: 'text-blue-400',
    standby: 'text-gray-500',  STANDBY: 'text-gray-500',
    FAULT:   'text-red-400',   fault:   'text-red-400',
  }
  return map[state] ?? 'text-gray-500'
}

export function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
}
