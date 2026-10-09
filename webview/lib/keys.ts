export type KeyAction = "undo" | "redo" | "blur" | "close" | null;

type Keys = {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
};

/** Board undo and redo from the panel, except inside fields, where the browser's own undo stays. */
export function keyAction(event: Keys, inField: boolean): KeyAction {
    if (event.key === "Escape") return inField ? "blur" : "close";
    if (inField || event.altKey || !(event.metaKey || event.ctrlKey)) {
        return null;
    }
    const key = event.key.toLowerCase();
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y" && event.ctrlKey && !event.metaKey) return "redo";
    return null;
}

const TEXT_INPUTS = new Set([
    "text",
    "search",
    "url",
    "tel",
    "email",
    "password",
    "number",
]);

export function isField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target instanceof HTMLTextAreaElement) return true;
    if (target instanceof HTMLSelectElement) return true;
    return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type);
}
