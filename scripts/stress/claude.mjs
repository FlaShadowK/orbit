#!/usr/bin/env node
// Fake agent CLI for stress tests. Named claude.mjs so Orbit's process scan detects it as
// Claude Code (`node …/claude.mjs`) and runs status guessing / activity tracking on it.
//
// Mimics Claude Code's terminal behaviour: an Ink-style status region redrawn ~10x/s while
// working ("… esc to interrupt"), bursts of streamed output, the odd large dump (diffs, file
// reads), permission prompts, idle prompt boxes between turns, and files written to the cwd.
//
// FAKE_INTENSITY (default 1) scales output volume; FAKE_WRITE_FILES=0 disables file writes.
import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

const INTENSITY = Number(process.env.FAKE_INTENSITY ?? 1)
const WRITE_FILES = process.env.FAKE_WRITE_FILES !== '0'
let seed = process.pid * 2654435761
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const between = (a, b) => a + rnd() * (b - a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = (s) => process.stdout.write(s)

const SPIN = ['✻', '✶', '✳', '✢', '✽', '·']
const VERBS = ['Pondering', 'Thinking', 'Reticulating', 'Brewing', 'Cogitating', 'Synthesizing']
const WORDS = 'the agent reads files runs commands and edits code while streaming tokens to the terminal for review'.split(' ')
const COLORS = [31, 32, 33, 34, 35, 36, 90]

function line(n = 12) {
  let s = ''
  for (let i = 0; i < n; i++) s += WORDS[Math.floor(rnd() * WORDS.length)] + ' '
  return `\x1b[${COLORS[Math.floor(rnd() * COLORS.length)]}m${s}\x1b[0m`
}

/** Ink redraws its whole dynamic region: move up, clear, repaint (~5 lines). */
let regionLines = 0
function redraw(lines) {
  let s = ''
  if (regionLines) s += `\x1b[${regionLines}A\r`
  s += lines.map((l) => `\x1b[2K${l}`).join('\r\n') + '\r\n'
  regionLines = lines.length
  out(s)
}
function commit(text) {
  // printing permanent output above the region: clear region, write text, region repaints next frame
  if (regionLines) out(`\x1b[${regionLines}A\r\x1b[J`)
  regionLines = 0
  out(text)
}

const dir = join(process.cwd(), 'stress-out')
const written = []
function writeFile(turn) {
  if (!WRITE_FILES) return
  mkdirSync(dir, { recursive: true })
  const f = join(dir, `agent-${process.pid}-${turn}-${written.length}.txt`)
  writeFileSync(f, line(40).repeat(20))
  written.push(f)
  if (written.length > 6) try { unlinkSync(written.shift()) } catch {}
}

async function work(turn) {
  const ms = between(4000, 16000)
  const start = Date.now()
  const verb = VERBS[Math.floor(rnd() * VERBS.length)]
  let frame = 0
  let nextBurst = Date.now() + between(300, 1500)
  let nextFile = Date.now() + between(1000, 4000)
  while (Date.now() - start < ms) {
    const secs = Math.floor((Date.now() - start) / 1000)
    redraw([
      '',
      `\x1b[38;5;209m${SPIN[frame++ % SPIN.length]} ${verb}…\x1b[0m \x1b[2m(${secs}s · ↓ ${(secs * 0.4).toFixed(1)}k tokens · esc to interrupt)\x1b[0m`,
      '',
      '\x1b[2m╭──────────────────────────────────────────────────────────────────────╮\x1b[0m',
      '\x1b[2m│\x1b[0m > \x1b[2m                                                                  │\x1b[0m',
      '\x1b[2m╰──────────────────────────────────────────────────────────────────────╯\x1b[0m'
    ])
    if (Date.now() > nextBurst) {
      const big = rnd() < 0.06
      const n = Math.round((big ? between(300, 1200) : between(4, 40)) * INTENSITY)
      let s = `\r\n\x1b[1m⏺ ${big ? 'Read' : 'Update'}\x1b[0m(src/file${turn}.ts)\r\n`
      for (let i = 0; i < n; i++) s += `  ${String(i + 1).padStart(4)} ${rnd() < 0.5 ? '\x1b[32m+' : '\x1b[31m-'}\x1b[0m ${line()}\r\n`
      commit(s)
      nextBurst = Date.now() + between(400, 2000) / INTENSITY
    }
    if (Date.now() > nextFile) {
      writeFile(turn)
      nextFile = Date.now() + between(2000, 6000)
    }
    await sleep(between(80, 120))
  }
}

async function main() {
  out('\x1b[38;5;209m✻ Welcome to Claude Code (fake)\x1b[0m\r\n\r\n')
  for (let turn = 0; ; turn++) {
    await work(turn)
    if (rnd() < 0.15) {
      commit('\r\n\x1b[1mBash command\x1b[0m\r\n  npm test\r\n\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n')
      await sleep(between(3000, 8000))
    }
    commit(`\r\n\x1b[1m⏺\x1b[0m Done with turn ${turn}.\r\n\r\n> `)
    await sleep(between(2000, 6000))
  }
}

process.on('SIGHUP', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
main()
