<div align="center">

<img src="build/icon.png" width="128" alt="Orbit icon" />

# Orbit

**Your agents, your terminals, your servers: one workspace.**

The all-in-one agentic development & devops desktop app.<br/>
Build a program, push it, and deploy it from a single session.

[![Release](https://img.shields.io/github/v/release/FlaShadowK/orbit?style=flat-square&color=5b5cff&label=release)](https://github.com/FlaShadowK/orbit/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/FlaShadowK/orbit/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/FlaShadowK/orbit/actions/workflows/ci.yml)
[![Platforms](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-1c2140?style=flat-square)](#-install)
[![License: MIT](https://img.shields.io/badge/license-MIT-3b2fbf?style=flat-square)](LICENSE)

[**Download**](https://github.com/FlaShadowK/orbit/releases/latest) · [Features](#-features) · [Shortcuts](#%EF%B8%8F-shortcuts) · [Development](#-development)

</div>

---

## 🪐 Why Orbit?

Coding agents are good at writing code. Shipping it still means juggling a terminal, an editor, a git client, an SSH client and a monitoring dashboard. Orbit puts all of those in one window and connects them:

- 🤖 **Agents in tabs**: run Claude Code, Codex, Gemini CLI, opencode or any CLI side by side, with a live status on every tab.
- 🛰️ **Server access for agents**: a built-in MCP server lets every agent `ssh_exec`, `sftp_*` and `upload` to the servers you saved, and logs every call.
- 🧑‍💻 **A full workbench**: a GPU terminal, the Monaco editor, a git panel with a review tab, SFTP, and live server stats.

```
 you ──▶ agent tab ──▶ writes code ──▶ Review & commit ──▶ push
                           │
                           └──▶ orbit MCP ──▶ ssh_exec on prod ──▶ docker compose up ✔
```

## ✨ Features

### 🌌 Spaces & agent tabs
- **One space per project folder**, each with its own tabs (agents, terminals, SSH, editors, SFTP). Layouts are saved and restored.
- **Agent tabs** for Claude Code, Codex, Gemini CLI, opencode, or any custom command (Settings).
- **Your own aliases**: add commands like `claude-work` or `claude-personal` from a space's start page. Shell aliases and functions work, and Orbit still adds its MCP server and status hooks.
- **Detected wherever they start**: run `claude`, `codex`, `gemini` or an alias in any terminal tab and it becomes an agent tab automatically.
- **Quiet status dot**: it breathes while the agent works, turns amber with **Needs you** when the agent waits for input, and turns green when the agent is done. You also get a desktop notification when an agent needs you.
- **Claude tabs are wired up for you**: the Orbit MCP server (`--mcp-config`) and status hooks (`--settings`) are injected, and each tab resumes its own conversation after a restart (`--session-id` / `--resume`).

### 🖥️ Terminal
- xterm.js with the **WebGL renderer** and node-pty, running your login shell with your PATH.
- **Split panes in any direction**, drag tabs to split, and **detach tabs into their own windows**.
- **Paste images** (⌘V): Claude tabs get them as attachments (`[Image #1]`). Other tabs get the path of a saved temp file.
- Drag & drop files to insert their paths. Native macOS editing keys (⌘⌫, ⌥⌫, ⌥←/→, ⇧↵ for newlines in agent prompts).

### 📝 Editor
- **Monaco**, the editor behind VS Code. Files reload live when an agent changes them on disk.
- Remote files open over SFTP and save back with ⌘S.
- **Markdown preview**: `.md` files open rendered, with **Edit · Split · Preview** modes, live updates, highlighted code blocks and local images.

### 🌿 Git panel & review tab
- Branch switcher, plus **Review · Pull · Commit · Push** in one row.
- A **Review** tab with a staged-file list and an inline or side-by-side diff, then **Commit** or **Commit & Push**.
- Orbit locks branch switching while an agent is working on the branch.

### 🛰️ Servers
- Host, user, key / password / ssh-agent, jump host, default directory, plus tags and notes that agents can read.
- Secrets are encrypted with the OS keychain (Electron `safeStorage`). Import hosts from `~/.ssh/config`.

### 📈 Live server stats (Beszel)
- Connect a server to a [Beszel](https://beszel.dev) hub to show its stats in the sidebar.
- **Configurable tiles**: CPU sparklines, RAM/disk gauges, network, Docker containers and more. Add, change and drag-reorder them.

### 🔌 Orbit MCP server
Runs at `http://127.0.0.1:47821/mcp` and requires a bearer token.

| Tool | What it does |
|---|---|
| `list_servers` | Lists saved servers (no secrets) |
| `ssh_exec` | Runs a command on a server and returns stdout, stderr and the exit code |
| `sftp_list` / `sftp_read` / `sftp_write` | Browses, reads and writes remote files |
| `upload` | Copies a local file or folder to a server (skips `node_modules` / `.git`) |
| `open_terminal` | Opens a visible SSH tab for you |
| `list_spaces` | Lists your Orbit spaces |

Every call is logged in the **Activity** panel (⌘J). Settings → **Register in Claude Code globally** also gives Claude sessions outside Orbit access to the server.

### 🔄 Auto-update
Orbit checks GitHub Releases and updates itself in place.

## ⌨️ Shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| New agent tab | <kbd>⌘T</kbd> | <kbd>Ctrl+Shift+T</kbd> |
| New terminal tab | <kbd>⌘⇧T</kbd> | <kbd>Ctrl+Shift+E</kbd> |
| New space | <kbd>⌘⇧N</kbd> | <kbd>Ctrl+Shift+N</kbd> |
| Command palette | <kbd>⌘K</kbd> | <kbd>Ctrl+Shift+P</kbd> |
| Switch tab | <kbd>⌘1..9</kbd> | <kbd>Alt+1..9</kbd> |
| Switch space | <kbd>⌃1..9</kbd> | <kbd>Ctrl+Alt+1..9</kbd> |
| Next / previous tab | <kbd>⌘⇧]</kbd> / <kbd>⌘⇧[</kbd> | <kbd>Ctrl+Tab</kbd> |
| Split right / down | <kbd>⌘D</kbd> / <kbd>⌘⇧D</kbd> | <kbd>Ctrl+Shift+D</kbd> / <kbd>Alt+Shift+D</kbd> |
| Toggle files / activity | <kbd>⌘B</kbd> / <kbd>⌘J</kbd> | <kbd>Ctrl+Shift+B</kbd> / <kbd>Ctrl+Shift+J</kbd> |
| Save / close tab | <kbd>⌘S</kbd> / <kbd>⌘W</kbd> | <kbd>Ctrl+S</kbd> / <kbd>Ctrl+Shift+W</kbd> |
| Copy / paste in terminal | <kbd>⌘C</kbd> / <kbd>⌘V</kbd> | <kbd>Ctrl+Shift+C</kbd> / <kbd>Ctrl+Shift+V</kbd> |

> Windows and Linux use Ctrl+Shift, so plain Ctrl+C, Ctrl+D, Ctrl+W, etc. still reach the terminal.

## 📦 Install

Grab the latest build from **[Releases](https://github.com/FlaShadowK/orbit/releases/latest)**:

| Platform | Files |
|---|---|
|  macOS | `Orbit-<v>-mac-arm64.dmg` (Apple Silicon) · `Orbit-<v>-mac-x64.dmg` (Intel) |
| 🪟 Windows | `Orbit-Setup-<v>.exe` (picks the architecture automatically) · `-x64.exe` · `-arm64.exe` |
| 🐧 Linux | `.AppImage` · `.deb` · `.rpm` |

<details>
<summary><b>First launch on an unsigned build</b></summary>

- **macOS:** release builds are ad-hoc signed, not notarized. If macOS says it *"could not verify"* Orbit, open **System Settings → Privacy & Security** and click **Open Anyway**. Or run this once:
  ```bash
  xattr -dr com.apple.quarantine /Applications/Orbit.app
  ```
- **Windows:** SmartScreen will warn. Click **More info → Run anyway**.

</details>

## 🛠️ Development

```bash
npm install        # native modules (node-pty) are rebuilt for Electron in postinstall
npm run dev        # hot reload
npm run typecheck
npm test
npm run stress -- --agents 50   # N fake agents streaming at once; add --intensity 5 --visible 9 --cycle for heavy load
```

**Stack:** Electron · React 19 · TypeScript · electron-vite · xterm.js · node-pty · ssh2 · Monaco · zustand · MCP TypeScript SDK

<details>
<summary><b>Building installers locally</b></summary>

```bash
npm run build:mac     # both DMGs
npm run build:win     # NSIS installers (cross-builds fine from macOS)
npm run build:linux   # AppImage/deb/rpm, built inside Docker so node-pty compiles for Linux
npm run dist          # all of the above
```

Output goes to `dist/`.

</details>

<details>
<summary><b>Publishing a release</b></summary>

GitHub Actions (`.github/workflows/release.yml`) builds the installers natively on macOS, Windows and Linux:

```bash
npm version patch            # bumps package.json, commits, and tags vX.Y.Z
git push --follow-tags       # pushing the v* tag starts the release build
```

After about 15 minutes the installers appear under **Releases**. To test a build without publishing it, run the workflow manually from the **Actions** tab. The installers are then attached to the run as artifacts.

</details>

## 🔒 Security notes

- The MCP server listens on `127.0.0.1` only and requires the bearer token stored in the app settings.
- Orbit doesn't gate the commands agents run on servers. Agents rely on their own permission or auto-mode checks, and everything they run is logged in **Activity**.
- SSH host keys are currently accepted without verification (no `known_hosts` check yet).

---

<div align="center">

MIT © Arman Omerovic

</div>
