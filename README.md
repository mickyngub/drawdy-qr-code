# QR Code

Make a scannable QR code for a link, Wi-Fi login, contact and more, and place it on your Drawdy board as shapes you can recolour or as a crisp image.

## How to use

1. Click the QR Code button (white finder squares on a green tile) on the right of the board.
2. Pick what the code holds under **Content**: Link, Text, Wi-Fi, Email, Phone, SMS, Contact or Location, then fill in the fields. The preview updates as you type, and **Payload** shows the exact text inside the code. Until the fields are filled, the preview tells you what is missing and **Place on board** stays off.
3. Shape it under **Options**:
   - **Error correction**: L, M, Q or H. Higher levels survive more damage but make a denser code.
   - **Quiet zone**: the blank margin, 2 to 4 modules.
   - **Modules**: Square, Dots or Rounded. Dots and Rounded keep solid corner squares so phones still find the code.
   - **Size on the board**, **Code colour** and **Background**. The line under the colours shows the contrast and warns you below 4:1, or when the code is lighter than its background.
   - **Caption**: optional text under the code, inside the card.
   - **Place as**: shapes you can recolour, or a PNG image.
   - **Reset options** brings the options back to their defaults.
4. Click **Place on board**. The code lands in the middle of your view, and the board moves to it.
5. To change a code you made, select it on the board, open the panel and click **Edit selected**. Change anything, then click **Update on board**: the old code is replaced in the same spot. **Stop editing** goes back to making new codes. Press Escape to close the panel.

## Good to know

- The code is a white card with dark modules in fixed colours, so it scans the same for viewers in light and dark theme.
- As shapes, each code is one group: a card plus one rectangle per run of modules (or one shape per dot). One placement holds at most 3,000 shapes; for a bigger code, pick Square, shorten the content or place it as an image. As an image, it is one PNG with whole pixels per module, about 1,000 px wide.
- Undo removes a new code in one step. Updating a code takes two undo steps to reverse.
- The board draws captions in its handwriting font, so a caption may sit a little differently than in the preview.
- The panel loads nothing from the network. Your content stays in the panel and on the board.
- Your options (content type, error correction, quiet zone, style, size, colours and output) are saved with Drawdy's extension storage (`kv-storage`) and come back next time. The text you type, such as a Wi-Fi password, is not saved there. It is part of each code you place, so anyone who can see the board can read it.

## Third-party code

- [QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library) by Project Nayuki, TypeScript version 1.8.0, MIT licence, vendored in `src/vendor/qrcodegen.ts` with its licence header.
- Tests use [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) to scan generated codes. It is a dev dependency and is not bundled.

## Licence

This extension's code is [MIT](LICENSE).

## Development

```bash
npm install
npm test
npm run typecheck
npm run dev          # dev server on :5199; in Drawdy run ⌘K → "Add extension dev server" on a local board
npm run build        # regenerates src/webview-html.ts and dist/*.drawdyx
npm run preflight    # before submitting: committed, built, pushed, under Drawdy's limits, above the live version
```

Drawdy builds published versions from this repository's `src/index.ts`, so commit `src/webview-html.ts` after `npm run build`. Bump `driverVersion` in `manifest.json` for every release and add it to `CHANGELOG.md`. `npm test` holds the manifest and listing files to Drawdy's submission rules, and scans every content type at every error correction level back to its payload.
