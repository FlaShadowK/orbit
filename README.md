# Orbit

All-in-one agentic development & devops workspace: herdr/Warp-style **spaces + agent tabs**, a **Monaco file editor**, a **Termius-style SSH client**, and a built-in **MCP server** that gives every agent direct access to all servers saved in the app.

Build a program, push it and set up its deployment from a single session.

## Features

- **Spaces**: one per project folder, each with its own tabs (agents, terminals, SSH, editors, SFTP browsers). The layout is saved and restored.
- **Agent tabs**: Claude Code, Codex, Gemini CLI, opencode, or any custom command (Settings). Each tab shows a live status badge (working / needs input / finished). You get a desktop notification when an agent needs you.
  - Claude tabs get the Orbit MCP server (`--mcp-config`) and status hooks (`--settings`) injected automatically. They resume their own conversation after an app restart (`--session-id` / `--resume`).
- **Terminal**: xterm.js (GPU renderer) + node-pty with your login shell and PATH, split panes (⌘D / ⌘⇧D).
  - Paste an image (⌘V): Claude tabs get it as an attachment (`[Image #1]`). Other tabs get the path of a saved temp file.
  - Drag & drop files to insert their paths.
  - macOS keys: ⌘⌫ delete line, ⌥⌫ delete word, ⌘←/→ line start/end, ⌥←/→ word jump, ⇧↵ newline in agent prompts.
- **Editor**: Monaco (the VS Code editor). Files reload live when an agent changes them on disk. Remote files open over SFTP and save back with ⌘S.
- **Servers**: host, user, key / password / ssh-agent, jump host, default dir, tags and notes for agents. Secrets are encrypted with the OS keychain (Electron `safeStorage`). Import from `~/.ssh/config`.
- **Orbit MCP server**: `http://127.0.0.1:47821/mcp` (bearer token). Tools:
  `list_servers`, `ssh_exec`, `sftp_list`, `sftp_read`, `sftp_write`, `upload`, `open_terminal`, `list_spaces`.
  Every call is logged in the **Activity** panel (⌘J). Settings → "Register in Claude Code globally" also exposes it to Claude sessions outside Orbit.

## Shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| New agent tab | ⌘T | Ctrl+Shift+T |
| New terminal tab | ⌘⇧T | Ctrl+Shift+E |
| New space | ⌘⇧N | Ctrl+Shift+N |
| Command palette | ⌘K | Ctrl+Shift+P |
| Switch tab | ⌘1..9 | Alt+1..9 |
| Switch space | ⌃1..9 | Ctrl+Alt+1..9 |
| Next / previous tab | ⌘⇧] / ⌘⇧[ | Ctrl+Tab |
| Split right / down | ⌘D / ⌘⇧D | Ctrl+Shift+D / Alt+Shift+D |
| Toggle files / activity | ⌘B / ⌘J | Ctrl+Shift+B / Ctrl+Shift+J |
| Save / close tab | ⌘S / ⌘W | Ctrl+S / Ctrl+Shift+W |
| Copy / paste in terminal | ⌘C / ⌘V | Ctrl+Shift+C / Ctrl+Shift+V |

Windows/Linux use Ctrl+Shift so plain Ctrl+C, Ctrl+D, Ctrl+W, etc. still reach the terminal.

## Installers

| Platform | Files (in `dist/`) |
|---|---|
| macOS | `Orbit-<v>-mac-arm64.dmg` (Apple Silicon), `Orbit-<v>-mac-x64.dmg` (Intel) |
| Windows | `Orbit-Setup-<v>-x64.exe`, `Orbit-Setup-<v>-arm64.exe`, `Orbit-Setup-<v>.exe` (picks the architecture automatically) |
| Linux | `Orbit-<v>-linux-x86_64.AppImage`, `Orbit-<v>-linux-amd64.deb`, `Orbit-<v>-linux-x86_64.rpm` |

```bash
npm run build:mac     # both DMGs
npm run build:win     # NSIS installers (cross-builds fine from macOS)
npm run build:linux   # AppImage/deb/rpm, built inside Docker so node-pty compiles for Linux
npm run dist          # all of the above
```

The installers aren't code-signed yet:
- **macOS:** the app is signed with your Apple Development certificate but not notarized. On another Mac, right-click → Open the first time.
- **Windows:** SmartScreen will warn. Click "More info → Run anyway".

  Release builds made by GitHub Actions are ad-hoc signed (no Apple Developer account). The first time you open a downloaded copy, macOS says it *"could not verify"* Orbit: open **System Settings → Privacy & Security** and click **Open Anyway**. Or run `xattr -dr com.apple.quarantine /Applications/Orbit.app` once.

### Publishing a release

Releases are built by GitHub Actions (`.github/workflows/release.yml`), natively on macOS, Windows and Linux:

```bash
npm version patch            # bumps package.json (0.1.0 → 0.1.1), commits, and tags v0.1.1
git push --follow-tags       # pushing the v* tag starts the release build
```

After ~15 minutes the installers show up under **Releases** on GitHub. To test the build without publishing, run the workflow manually from the **Actions** tab ("Run workflow"). The installers are then attached to the run as artifacts.

## Development

```bash
npm install        # native modules (node-pty) are rebuilt for Electron in postinstall
npm run dev        # run with hot reload
npm run typecheck
npm test
```

Stack: Electron · React · TypeScript · electron-vite · xterm.js · node-pty · ssh2 · Monaco · MCP TypeScript SDK.

## Security notes

- The MCP server listens on 127.0.0.1 only and requires the bearer token stored in the app settings.
- Agent server commands aren't gated by Orbit. Agents rely on their own permission/auto-mode checks. Everything they run is logged in Activity.
- SSH host keys are currently accepted without verification (no known_hosts check yet).
