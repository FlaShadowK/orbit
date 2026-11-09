const PATHS: Record<string, string> = {
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  terminal: 'M4 17l6-5-6-5M12 19h8',
  agent: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  server: 'M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01',
  file: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6',
  split: 'M4 4h16v16H4zM12 4v16M15 12h3',
  'split-left': 'M4 4h16v16H4zM12 4v16M6 12h3',
  'split-down': 'M4 4h16v16H4zM4 12h16M12 15v3',
  'split-up': 'M4 4h16v16H4zM4 12h16M12 6v3',
  window: 'M3 5h13v11H3zM8 20h13V9',
  dock: 'M4 4h16v16H4zM4 9h16M12 12v5M9.5 14.5L12 17l2.5-2.5',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  files: 'M15 2H8a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7zM15 2v5h5M4 8v12a2 2 0 002 2h10',
  up: 'M12 19V5M5 12l7-7 7 7',
  sidebar: 'M3 4h18v16H3zM9 4v16',
  link: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7',
  globe: 'M12 22a10 10 0 100-20 10 10 0 000 20zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20',
  check: 'M20 6L9 17l-5-5',
  branch: 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9',
  commit: 'M12 15a3 3 0 100-6 3 3 0 000 6zM3 12h6M15 12h6',
  diff: 'M12 3v14M5 10h14M5 21h14',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4'
}

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? PATHS.file} />
    </svg>
  )
}
