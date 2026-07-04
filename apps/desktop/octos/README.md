# Octos WebView2 validation

This package verifies the existing React renderer independently from Electron.
It is not the production wallpaper host.

## Build on macOS or Windows

From the repository root:

```bash
pnpm --filter @wallpaper/desktop build:octos
```

The generated Octos mod is written to:

```text
apps/desktop/dist/octos
```

## Run on Windows

Install Octos and make its CLI available, then run:

```powershell
octos run .\apps\desktop\dist\octos --dev-tools
```

Expected diagnostics:

- `platform: octos-webview2` (or `webview2` if Octos uses a `file:` URL)
- `embedded: true`
- `template: triptych_desktop_equal`
- all three slots remain visible behind desktop icons

Also verify Explorer restart, display reconnect, sleep/resume, and at least
five minutes of steady rendering. A failure here belongs to the renderer or
WebView2 path; a success clears the way for `wallpaper-host.exe`.
