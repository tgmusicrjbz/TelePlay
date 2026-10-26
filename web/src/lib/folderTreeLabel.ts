/** Avoid bidi-sensitive box drawing glyphs inside RTL controls. */
export function folderTreeLabel(name: string, depth = 0): string {
    if (!depth) return `🗂️ ${name}`;
    const indent = '\u00a0\u00a0\u00a0'.repeat(depth);
    return `${indent}▫️ 🗂️ ${name}`;
}
