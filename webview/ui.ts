let uid = 0;
const nextUid = (prefix: string): string => `${prefix}-${++uid}`;

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    parent?: HTMLElement
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
}

function fieldWithLabel(
    parent: HTMLElement,
    text: string,
    forId?: string
): { wrap: HTMLDivElement; head: HTMLDivElement } {
    const wrap = el("div", "field", parent);
    const head = el("div", "field-head", wrap);
    if (forId) {
        const label = el("label", undefined, head);
        label.htmlFor = forId;
        label.textContent = text;
    } else {
        const label = el("span", "label", head);
        label.textContent = text;
    }
    return { wrap, head };
}

export type SliderSpec = {
    label: string;
    min: number;
    max: number;
    step: number;
    unit?: string;
};

export type SliderControl = { set(value: number): void };

export function makeSlider(
    parent: HTMLElement,
    spec: SliderSpec,
    initial: number,
    onInput: (value: number) => void
): SliderControl {
    const id = nextUid("slider");
    const { wrap, head } = fieldWithLabel(parent, spec.label, id);
    const value = el("span", "value", head);
    const input = el("input", undefined, wrap);
    input.id = id;
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    const show = (v: number) => {
        value.textContent = `${Math.round(v)}${spec.unit ?? ""}`;
    };
    input.value = String(initial);
    show(initial);
    input.addEventListener("input", () => {
        const v = Number(input.value);
        show(v);
        onInput(v);
    });
    return {
        set(v) {
            input.value = String(v);
            show(v);
        },
    };
}

export type SegmentedControl<T> = {
    head: HTMLDivElement;
    set(value: T): void;
    setHidden(hidden: boolean): void;
    setDisabled(values: T[]): void;
};

export function makeSegmented<T extends string | number>(
    parent: HTMLElement,
    label: string,
    options: [T, string, string?][],
    initial: T,
    onPick: (value: T) => void,
    grid = false
): SegmentedControl<T> {
    const { wrap, head } = fieldWithLabel(parent, label);
    const row = el("div", grid ? "seg grid" : "seg", wrap);
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", label);
    const buttons = options.map(([value, text, title]) => {
        const button = el("button", undefined, row);
        button.type = "button";
        button.textContent = text;
        if (title) button.title = title;
        button.addEventListener("click", () => {
            paint(value);
            onPick(value);
        });
        return { value, button };
    });
    const paint = (current: T) => {
        for (const entry of buttons) {
            const on = entry.value === current;
            entry.button.classList.toggle("on", on);
            entry.button.setAttribute("aria-pressed", String(on));
        }
    };
    paint(initial);
    return {
        head,
        set: paint,
        setHidden(hidden) {
            wrap.hidden = hidden;
        },
        setDisabled(values) {
            for (const entry of buttons) {
                entry.button.disabled = values.includes(entry.value);
            }
        },
    };
}

export type TextControl = {
    input: HTMLInputElement | HTMLTextAreaElement;
    wrap: HTMLDivElement;
    set(value: string): void;
};

export function makeText(
    parent: HTMLElement,
    label: string,
    options: {
        multiline?: boolean;
        type?: string;
        placeholder?: string;
        inputMode?: string;
        maxLength?: number;
        rows?: number;
        readOnly?: boolean;
        className?: string;
    },
    onInput?: (value: string) => void
): TextControl {
    const id = nextUid("text");
    const { wrap } = fieldWithLabel(parent, label, id);
    const input = options.multiline
        ? el("textarea", "text-input", wrap)
        : el("input", "text-input", wrap);
    if (options.className) input.classList.add(options.className);
    input.id = id;
    input.spellcheck = false;
    input.autocomplete = "off";
    if (input instanceof HTMLInputElement) input.type = options.type ?? "text";
    if (input instanceof HTMLTextAreaElement) input.rows = options.rows ?? 3;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.inputMode) input.inputMode = options.inputMode;
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.readOnly) input.readOnly = true;
    if (onInput) {
        input.addEventListener("input", () => onInput(input.value));
    }
    return {
        input,
        wrap,
        set(value) {
            if (input.value !== value) input.value = value;
        },
    };
}

export type CheckControl = { set(value: boolean): void };

export function makeCheck(
    parent: HTMLElement,
    label: string,
    onChange: (value: boolean) => void
): CheckControl {
    const wrap = el("label", "check", parent);
    const input = el("input", undefined, wrap);
    input.type = "checkbox";
    const text = el("span", undefined, wrap);
    text.textContent = label;
    input.addEventListener("change", () => onChange(input.checked));
    return {
        set(value) {
            input.checked = value;
        },
    };
}

export type ColourControl = { set(value: string): void };

export function makeColourRow(
    parent: HTMLElement,
    label: string,
    swatches: [string, string][],
    initial: string,
    onPick: (value: string) => void
): ColourControl {
    const { wrap } = fieldWithLabel(parent, label);
    const row = el("div", "swatches", wrap);
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", label);
    const buttons = swatches.map(([colour, name]) => {
        const button = el("button", "swatch", row);
        button.type = "button";
        button.style.background = colour;
        button.title = `${name} ${colour}`;
        button.setAttribute("aria-label", `${label}: ${name}`);
        button.addEventListener("click", () => {
            apply(colour);
            onPick(colour);
        });
        return { colour, button };
    });
    const picker = el("input", undefined, row);
    picker.type = "color";
    picker.setAttribute("aria-label", `${label}: pick any colour`);
    picker.addEventListener("input", () => {
        apply(picker.value);
        onPick(picker.value);
    });
    const apply = (colour: string) => {
        picker.value = colour;
        for (const entry of buttons) {
            const on = entry.colour.toLowerCase() === colour.toLowerCase();
            entry.button.classList.toggle("on", on);
            entry.button.setAttribute("aria-pressed", String(on));
        }
    };
    apply(initial);
    return { set: apply };
}

export function makeRule(parent: HTMLElement): void {
    el("div", "rule", parent);
}
