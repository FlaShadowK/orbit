# Orbit

All-in-one agentic development & devops workspace: herdr/Warp-style **spaces + agent tabs**, a **Monaco file editor**, a **Termius-style SSH client**, and a built-in **MCP server** that gives every agent direct access to all servers saved in the app.

Build a program, push it and set up its deployment from a single session.

## Features

- **Spaces**: one per project folder, each with its own tabs (agents, terminals, SSH, editors, SFTP browsers). The layout is saved and restored.
- **Agent tabs**: Claude Code, Codex, Gemini CLI, opencode, or any custom command (Settings). Each tab shows a live status badge (working / needs input / finished). You get a desktop notification when an agent needs you.
  - Claude tabs get the Orbit MCP server (`--mcp-config`) and status hooks (`--settings`) injected automatically. They resume their own conversation after an app restart (`--session-id` / `--resume`).
- **Terminal**: xterm.js + node-pty with your login shell and PATH, split panes (⌘D / ⌘⇧D).
- **Editor**: Monaco (the VS Code editor). Files reload live when an agent changes them on disk. Remote files open over SFTP and save back with ⌘S.
- **Servers**: host, user, key / password / ssh-agent, jump host, default dir, tags and notes for agents. Secrets are encrypted with the OS keychain (Electron `safeStorage`). Import from `~/.ssh/config`.
- **Orbit MCP server**: `http://127.0.0.1:47821/mcp` (bearer token). Tools:
  `list_servers`, `ssh_exec`, `sftp_list`, `sftp_read`, `sftp_write`, `upload`, `open_terminal`, `list_spaces`.
  Every call is logged in the **Activity** panel (⌘J). Settings → "Register in Claude Code globally" also exposes it to Claude sessions outside Orbit.

## Shortcuts

| | |
|---|---|
| ⌘T / ⌘⇧T | new agent / terminal tab |
| ⌘⇧N | new space |
| ⌘K | command palette |
| ⌘1..9 / ⌃1..9 | switch tab / space |
| ⌘⇧[ ⌘⇧] | previous / next tab |
| ⌘D / ⌘⇧D | split right / down |
| ⌘B / ⌘J | toggle files / activity |
| ⌘S / ⌘W | save / close tab |

## Development

```bash
npm install        # native modules (node-pty) are rebuilt for Electron in postinstall
npm run dev        # run with hot reload
npm run typecheck
npm test
npm run build:mac  # → dist/Orbit-<version>.dmg   (build:win, build:linux also available)
```

Stack: Electron · React · TypeScript · electron-vite · xterm.js · node-pty · ssh2 · Monaco · MCP TypeScript SDK.

## Security notes

- The MCP server listens on 127.0.0.1 only and requires the bearer token stored in the app settings.
- Agent server commands aren't gated by Orbit. Agents rely on their own permission/auto-mode checks. Everything they run is logged in Activity.
- SSH host keys are currently accepted without verification (no known_hosts check yet).
