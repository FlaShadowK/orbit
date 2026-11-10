import { describe, expect, it } from 'vitest'
import { agentUnder, detectAgent, indexProcs, parsePs } from './agentDetect'

describe('detectAgent', () => {
  it('recognises agent binaries however they are started', () => {
    expect(detectAgent('claude')).toBe('claude')
    expect(detectAgent('/Users/me/.local/bin/claude --resume')).toBe('claude')
    expect(detectAgent('/Users/me/.local/share/claude/versions/2.0.14')).toBe('claude')
    expect(detectAgent('node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js')).toBe('claude')
    expect(detectAgent('node /opt/homebrew/bin/codex')).toBe('codex')
    expect(detectAgent('/opt/homebrew/lib/node_modules/@openai/codex/vendor/codex exec')).toBe('codex')
    expect(detectAgent('node --no-warnings /x/@google/gemini-cli/dist/index.js')).toBe('gemini')
    expect(detectAgent('opencode')).toBe('opencode')
  })

  it('ignores commands that merely mention an agent', () => {
    expect(detectAgent('vim claude.md')).toBeNull()
    expect(detectAgent('grep claude notes.txt')).toBeNull()
    expect(detectAgent('-zsh')).toBeNull()
    expect(detectAgent('node server.js')).toBeNull()
  })
})

describe('agentUnder', () => {
  const procs = parsePs(`
    100     1 /Applications/Orbit.app/Contents/MacOS/Orbit
    200   100 -zsh
    300   200 node /usr/local/bin/claude
    310   300 /bin/zsh -c npm test
    400   100 /bin/zsh -l
    500   400 vim claude.md
    600   100 node /x/@openai/codex/bin/codex.js
  `)

  it('finds the agent below a shell', () => {
    expect(agentUnder(200, procs)).toBe('claude')
  })

  it('returns null when no agent runs in that terminal', () => {
    expect(agentUnder(400, procs)).toBeNull()
  })

  it('finds an agent that replaced the shell (exec claude)', () => {
    expect(agentUnder(600, procs)).toBe('codex')
  })

  it('accepts a prebuilt index so one scan serves every terminal', () => {
    const idx = indexProcs(procs)
    expect(agentUnder(200, idx)).toBe('claude')
    expect(agentUnder(400, idx)).toBeNull()
    expect(agentUnder(999, idx)).toBeNull()
  })
})
