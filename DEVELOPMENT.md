# Developing QR Code

```bash
npm install
npm test
npm run typecheck
npm run dev          # dev server on :5199; in Drawdy run ⌘K → "Add extension dev server" on a local board
npm run build        # regenerates src/webview-html.ts and dist/*.drawdyx
npm run preflight    # before submitting: committed, built, pushed, under Drawdy's limits, above the live version
```

Drawdy builds published versions from this repository's `src/index.ts`, so commit `src/webview-html.ts` after `npm run build`. Bump `driverVersion` in `manifest.json` for every release and add it to `CHANGELOG.md`. `npm test` holds the manifest and listing files to Drawdy's submission rules, and scans every content type at every error correction level back to its payload.

The tests use [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) to scan the generated codes. It is a dev dependency and is not bundled.
