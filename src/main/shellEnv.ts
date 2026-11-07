import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, join } from 'path'
import { homedir } from 'os'

let cached: NodeJS.ProcessEnv | null = null

export function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

/**
 * GUI apps on macOS/Linux start with a minimal PATH. Ask the user's login
 * shell for its environment once so agents/git/etc resolve like in Terminal.
 */
export function shellEnv(): NodeJS.ProcessEnv {
  if (cached) return cached
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (process.platform !== 'win32') {
    try {
      const marker = '__ORBIT_ENV__'
      const out = execFileSync(defaultShell(), ['-ilc', `echo ${marker}; env; echo ${marker}`], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, ORBIT_RESOLVING_ENV: '1' }
      })
      const body = out.split(marker)[1] ?? ''
      for (const line of body.split('\n')) {
        const i = line.indexOf('=')
        if (i > 0) env[line.slice(0, i)] = line.slice(i + 1)
      }
    } catch (err) {
      console.warn('[orbit] could not resolve login shell env', err)
    }
    const extra = [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
    const parts = (env.PATH ?? '').split(delimiter)
    for (const p of extra) if (!parts.includes(p)) parts.push(p)
    env.PATH = parts.join(delimiter)
  }
  delete env.ELECTRON_RUN_AS_NODE
  // don't leak a parent Claude Code session's env into agents started inside Orbit
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k]
  env.TERM_PROGRAM = 'Orbit'
  env.COLORTERM = 'truecolor'
  cached = env
  return env
}

export function which(cmd: string): string | null {
  const env = shellEnv()
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext.toLowerCase())
      if (existsSync(p)) return p
      const p2 = join(dir, cmd + ext)
      if (existsSync(p2)) return p2
    }
  }
  return null
}
