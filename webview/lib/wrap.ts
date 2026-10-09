type Fits = (text: string) => boolean;

function segments(text: string, granularity: "word" | "grapheme"): string[] {
    if (typeof Intl === "undefined" || !("Segmenter" in Intl)) {
        return Array.from(text);
    }
    const segmenter = new Intl.Segmenter(undefined, { granularity });
    return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** A word too wide for one line breaks at word boundaries (Thai has no spaces), then between characters. */
export function breakWord(word: string, fits: Fits): string[] {
    if (fits(word)) return [word];
    return segments(word, "word").flatMap((part) =>
        fits(part) ? [part] : segments(part, "grapheme")
    );
}

export function wrapCaption(
    text: string,
    maxWidth: number,
    measure: (text: string) => number
): string[] {
    const fits: Fits = (t) => measure(t) <= maxWidth;
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
        let line = "";
        for (const token of paragraph.split(/(\s+)/)) {
            if (token === "") continue;
            const parts = /^\s+$/.test(token) ? [token] : breakWord(token, fits);
            for (const part of parts) {
                const next = line + part;
                if (line.trim() && !fits(next.trimEnd())) {
                    lines.push(line.trimEnd());
                    line = part.trimStart();
                } else {
                    line = next;
                }
            }
        }
        lines.push(line.trimEnd());
    }
    return lines.filter((l, i) => l || i < lines.length - 1);
}
