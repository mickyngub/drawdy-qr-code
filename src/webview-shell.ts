const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--drawdy-background, #ffffff);
    color: var(--drawdy-foreground, #111111);
    font-size: 12px;
    line-height: 1.4;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--drawdy-primary, #4f46e5); outline-offset: 1px; }

.scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.stage {
    flex: none;
    position: relative;
    height: 184px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--drawdy-radius-md, 8px);
    border: 1px solid var(--drawdy-border, #e5e5e5);
    background: var(--drawdy-surface, #fafafa);
    overflow: hidden;
}
.stage canvas {
    display: block;
    box-shadow: 0 0 0 1px var(--drawdy-border, #e5e5e5);
}
.stage canvas[hidden] { display: none; }
.hint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 20px;
    pointer-events: none;
}
.hint[hidden] { display: none; }
.hint span {
    max-width: 240px;
    padding: 8px 12px;
    border-radius: var(--drawdy-radius-md, 8px);
    border: 1px dashed var(--drawdy-border, #e5e5e5);
    color: var(--drawdy-muted-foreground, #7a7a7a);
    font-size: 11px;
}
.hint.bad span { color: var(--drawdy-destructive, #dc2626); border-style: solid; }

.readout {
    min-height: 14px;
    margin-top: -4px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--drawdy-muted-foreground, #7a7a7a);
    text-align: center;
}

.field { display: flex; flex-direction: column; gap: 3px; }
.field[hidden] { display: none; }
.field.dim { opacity: 0.45; }
.field-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
}
.field-head label, .field-head .label {
    font-size: 10px;
    letter-spacing: 0.02em;
    color: var(--drawdy-muted-foreground, #7a7a7a);
}
.field-head .value {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
}
.group { display: flex; flex-direction: column; gap: 8px; }
.group[hidden] { display: none; }

.text-input {
    width: 100%;
    padding: 5px 7px;
    border: 1px solid var(--drawdy-border, #e5e5e5);
    border-radius: var(--drawdy-radius-sm, 4px);
    background: var(--drawdy-background, #ffffff);
    font-size: 12px;
}
.text-input:disabled { opacity: 0.5; }
textarea.text-input { resize: none; }
textarea.payload {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    color: var(--drawdy-muted-foreground, #7a7a7a);
    background: var(--drawdy-surface, #fafafa);
    word-break: break-all;
}
.check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    cursor: pointer;
}
.check input { margin: 0; accent-color: var(--drawdy-primary, #4f46e5); }

input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 14px;
    background: transparent;
    cursor: pointer;
}
input[type="range"]::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 999px;
    background: var(--drawdy-border, #e0e0e0);
}
input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--drawdy-primary, #4f46e5);
}
input[type="range"]::-moz-range-track {
    height: 3px;
    border-radius: 999px;
    background: var(--drawdy-border, #e0e0e0);
}
input[type="range"]::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border: none;
    border-radius: 50%;
    background: var(--drawdy-primary, #4f46e5);
}

.seg {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
}
.seg.grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
}
.seg button {
    flex: 1 1 auto;
    min-width: 0;
    padding: 4px 6px;
    border: 1px solid var(--drawdy-border, #e5e5e5);
    background: transparent;
    color: var(--drawdy-muted-foreground, #7a7a7a);
    border-radius: var(--drawdy-radius-sm, 4px);
    cursor: pointer;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.seg button:hover { color: var(--drawdy-foreground, #111111); }
.seg button.on {
    background: var(--drawdy-primary, #4f46e5);
    border-color: var(--drawdy-primary, #4f46e5);
    color: var(--drawdy-primary-foreground, #ffffff);
}

.swatches { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--drawdy-border, #e5e5e5);
    cursor: pointer;
}
.swatch.on { outline: 2px solid var(--drawdy-primary, #4f46e5); outline-offset: 1px; }
input[type="color"] {
    width: 26px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--drawdy-border, #e5e5e5);
    border-radius: var(--drawdy-radius-sm, 4px);
    background: transparent;
    cursor: pointer;
}
.note {
    min-height: 28px;
    font-size: 10px;
    color: var(--drawdy-muted-foreground, #7a7a7a);
}
.note.bad { color: var(--drawdy-destructive, #dc2626); }

.rule {
    height: 1px;
    background: var(--drawdy-border, #e5e5e5);
    margin: 2px 0;
}
.section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
}
.link-btn {
    border: 1px solid var(--drawdy-border, #e5e5e5);
    background: transparent;
    border-radius: var(--drawdy-radius-sm, 4px);
    padding: 2px 7px;
    font-size: 10px;
    font-weight: 400;
    cursor: pointer;
    color: var(--drawdy-muted-foreground, #7a7a7a);
}
.link-btn:hover { color: var(--drawdy-foreground, #111111); }

footer {
    flex: none;
    border-top: 1px solid var(--drawdy-border, #e5e5e5);
    padding: 7px 12px 9px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--drawdy-surface, transparent);
}
.status {
    min-height: 28px;
    font-size: 10px;
    color: var(--drawdy-muted-foreground, #7a7a7a);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.status.bad { color: var(--drawdy-destructive, #dc2626); }
.status.good { color: var(--drawdy-success, #16a34a); }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.btn {
    flex: none;
    padding: 5px 11px;
    border-radius: var(--drawdy-radius-sm, 4px);
    border: 1px solid var(--drawdy-border, #e5e5e5);
    background: transparent;
    cursor: pointer;
    font-size: 11px;
}
.btn:hover:not(:disabled) { border-color: var(--drawdy-foreground, #111111); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.primary {
    background: var(--drawdy-primary, #4f46e5);
    border-color: var(--drawdy-primary, #4f46e5);
    color: var(--drawdy-primary-foreground, #ffffff);
}
.btn.ghost { visibility: hidden; }
`;

const BODY = `
<main class="scroll" id="scroll">
    <div class="stage" id="stage">
        <canvas id="canvas" role="img" aria-label="QR code preview" hidden></canvas>
        <div class="hint" id="hint"><span id="hint-text"></span></div>
    </div>
    <div class="readout" id="readout"></div>
    <div id="content"></div>
</main>
<footer>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="actions">
        <button type="button" class="btn ghost" id="secondary">Edit selected</button>
        <button type="button" class="btn primary" id="primary" disabled>Place on board</button>
    </div>
</footer>
`;

export function shellHtml(js: string): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>:root{/*__DRAWDY_STYLING__*/}</style>
<style>${CSS}</style>
</head>
<body>
${BODY}
<script>${js}</script>
</body>
</html>`;
}
