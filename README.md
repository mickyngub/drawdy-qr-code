# QR Code

Make a scannable QR code for a link, Wi-Fi login, contact and more, and place it on your Drawdy board as shapes you can recolour or as a crisp image.

## How to use

1. Click the QR Code button (white finder squares on a green tile) on the right of the board.
2. Pick what the code holds under **Content**: Link, Text, Wi-Fi, Email, Phone, SMS, Contact or Location, then fill in the fields. The preview updates as you type, and **Payload** shows the exact text inside the code. Until the fields are filled, the preview tells you what is missing and **Place on board** stays off. A link gets `https://` unless it already starts with a scheme and `//`, or with one that phones open without slashes (`mailto:`, `tel:`, `sms:`, `smsto:`, `geo:`, `market:`, `WIFI:`, `MATMSG:`, `BEGIN:VCARD`, `BEGIN:VEVENT`), so `example.com:8080/path` and `localhost:3000` become `https://` links. The Wi-Fi password is hidden as you type; **Show** reveals it.
3. Pick a look under **Look**:
   - **Picture in the middle**: None, the **Drawdy logo**, or **Your picture**. **Upload…** picks a PNG, JPG, WebP, GIF or SVG (up to 10 MB), and you can also drop one on the preview. The picture is kept as a 256 px square, transparent edges included, and sits in a clear square about a quarter of the code's width. While a picture is on, error correction stays at H so phones can still read the code; removing the picture unlocks the other levels again.
   - **Presets**: Classic, Drawdy, Navy dots, Mint, Cream and Violet set the module style and colours in one click, and each tile shows the look with your current picture. Drawdy also puts the Drawdy logo in the middle.
4. Shape it under **Options**:
   - **Error correction**: L, M, Q or H. Higher levels survive more damage but make a denser code.
   - **Quiet zone**: the blank margin, 2 to 4 modules.
   - **Modules**: Square, Dots or Rounded. Dots and Rounded keep solid corner squares so phones still find the code.
   - **Size on the board**, **Code colour** and **Background**. The line under the colours shows the contrast and warns you below 4:1, or when the code is lighter than its background.
   - **Caption**: optional text under the code, inside the card. In the PNG, a word too wide for the card, such as a Thai phrase without spaces, wraps between words or characters instead of running off the edges.
   - **Place as**: shapes you can recolour, or a PNG image.
   - **Reset options** brings the options back to their defaults.
5. Click **Place on board**. The code lands in the middle of the part of your view the panel doesn't cover, beside anything already there rather than on top of it, and is selected. The board only moves if the code doesn't fit in view.
6. To change a code you made, select it on the board, open the panel and click **Edit selected**. A banner shows you are editing, with **Stop editing** to go back to making new codes. Change anything, then click **Update on board**: the old code is replaced where it is now, even if you moved or resized it after Edit selected, keeping its group, layer, frame, lock and opacity. **Place as new** adds a copy instead. A rotated code comes back upright, and the panel says so.
7. Press ⌘Z or Ctrl+Z to undo on the board, from the panel too unless you are typing in a field. Press Escape to close the panel; inside a field, Escape only leaves the field.

## Good to know

- The code is a white card with dark modules in fixed colours, so it scans the same for viewers in light and dark theme.
- With a picture, the modules behind it are left out and the picture sits on top as one image in the code's group. As a PNG, the picture is drawn into the image.
- As shapes, each code is one group: a card plus one rectangle per run of modules (or one shape per dot). One placement holds at most 3,000 shapes; for a bigger code, pick Square, shorten the content or place it as an image. As an image, it is one PNG with whole pixels per module, about 1,000 px wide.
- A new code goes on in one step, however many shapes it has, so one ⌘Z removes all of it. An update removes the old code and then adds the new one, so it takes two undo steps to reverse (three for a locked code): the first leaves the spot empty, the second brings the old code back. If the board can't take the new code, the old one is put back. A board holds at most 10,000 elements; the panel tells you when it is full.
- Selecting a shapes code outlines every shape in it; that is how the board draws a selected group.
- Drawdy asks for storage and board access the first time you open the panel, not when the board loads.
- The board draws captions in its handwriting font, so a caption may sit a little differently than in the preview.
- The panel loads nothing from the network. Your content stays in the panel and on the board.
- Your options (content type, error correction, quiet zone, style, size, colours, picture and output) are saved with Drawdy's extension storage (`kv-storage`) and come back next time, your uploaded picture included. A code keeps your picture with it only when it shows it, so Edit selected brings it back. The text you type, such as a Wi-Fi password, is not saved there. It is part of each code you place, so anyone who can see the board can read it.

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
