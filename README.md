# Better Docker Desktop (Go / Wails)

The `better-docker-desktop` app ported from Tauri (Rust) to [Wails v3](https://v3.wails.io) (Go). Same React 19 + TypeScript frontend, same features; the Rust backend is rewritten in Go.

## Layout

```
main.go          app + window setup, embeds frontend/dist
service.go       the `App` service: every exported method is callable from the frontend
docker.go        Docker CLI wrapper (argv only, validated names, per-call timeouts)
kube.go          kubectl wrapper (read-only kinds, whitelisted actions)
stream.go        long-running commands (logs, pull, build, events) -> `stream-line` / `stream-end` events
shell.go         terminal sessions -> `shell-out` / `shell-end` events
pty_windows.go   ConPTY (github.com/UserExistsError/conpty)
pty_unix.go      Unix pty (github.com/creack/pty)
proc_*.go        hidden console window / detached start on Windows
frontend/        React app; src/platform.ts is the only file that talks to the Wails runtime
```

The frontend calls Go through `call("Method", ...args)` in `frontend/src/platform.ts`, which resolves to `main.App.<Method>`. Native dialogs, notifications and opening links are Go methods too (`PickFolder`, `PickFile`, `SaveFilePath`, `Notify`, `OpenURL`).

## Commands

```bash
./make.sh                      # build for the current OS
./make.sh win                  # Windows: portable exe (+ NSIS installer if makensis is installed) in dist/
./make.sh mac                  # macOS .app in dist/ (on a Mac)
./make.sh dev                  # run with hot reload
./make.sh test                 # go test ./... then the frontend typecheck and vitest
./make.sh version              # print the app version
./make.sh release patch        # bump the version, tag and push; the tag starts the GitHub release (-n for a dry run)
./make.sh makefile             # regenerate the Makefile from the case block in make.sh
```

The raw tools work too: `wails3 dev`, `wails3 build`, `wails3 package`, `go test ./...`, `cd frontend && npm test`.

## Releases

`.github/workflows/release.yml` builds on every `v*` tag: Windows (setup + portable exe) and macOS on Apple Silicon (dmg), then publishes a GitHub Release. Run it by hand from the Actions tab to build without publishing. `./make.sh release` keeps the version in `build/config.yml`, `frontend/package.json` (and its lock file) and `service.go` in step, which the workflow's tag check requires.

## Differences from the Tauri app

- No window size/position memory yet (Wails v3 has no window-state plugin).
- Only `http(s)://localhost` and `127.0.0.1` links open in the browser, enforced in `OpenURL` instead of a capability file.
- Wails v3 is still in alpha; pin the version in `go.mod` and `frontend/package.json` (`@wailsio/runtime`) together.

## Security notes

Same rules as the Rust version: arguments are always passed as an argv list (never through a shell), every user-supplied name is validated first, volume browsing runs a read-only throwaway container with no network, and only `docker.exe` / `docker` can be chosen as a custom CLI.
