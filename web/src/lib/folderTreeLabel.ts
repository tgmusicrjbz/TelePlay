/** Keep box drawing glyphs in their intended order inside RTL controls. */
export function folderTreeLabel(name: string, depth = 0): string {
    if (!depth) return `🗂️ ${name}`;
    const indent = '\u00a0\u00a0'.repeat(Math.max(0, depth - 1));
    // In RTL selects the branch grows from the right, so the corner must be
    // mirrored. Isolating only the drawing run prevents the browser from
    // moving its two glyphs around the Persian folder name.
    return `${indent}\u2066┘─\u2069 🗂️ ${name}`;
}
