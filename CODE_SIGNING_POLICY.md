# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What is signed

Only the Windows installers (`Orbit-Setup-<version>-<arch>.exe`) and the application files
inside them, built by this repository's GitHub Actions release workflow
(`.github/workflows/release.yml`) from a tagged commit on `main`. Nothing built on a
developer machine is signed.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [FlaShadowK](https://github.com/FlaShadowK) |
| Approvers | [FlaShadowK](https://github.com/FlaShadowK) |

Every signing request is approved manually by an approver. All team members use
multi-factor authentication on GitHub and SignPath.

## Privacy

Orbit sends nothing to the maintainers and contains no telemetry, analytics or crash reporting.
It only connects to other systems for things the user sets up or asks for:

- **Update checks:** reads release information from this repository on GitHub
  (can be turned off in Settings).
- **SSH / SFTP:** connects to the servers the user saves in the app.
- **Server stats:** connects to the Beszel hub the user configures for a server.
- **Agent CLIs** (Claude Code, Codex, Gemini CLI, …) that the user launches inside Orbit talk
  to their own providers under those tools' terms. Orbit's MCP server for them listens on
  `127.0.0.1` only and requires a per-install token.

Credentials for saved servers are stored locally, encrypted with the operating system's
keychain (Electron `safeStorage`) where one is available, and never leave the machine except
to authenticate to that server.
