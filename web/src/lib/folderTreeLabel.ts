/** Keep box drawing glyphs in their intended order inside RTL controls. */
export function folderTreeLabel(name: string, depth = 0): string {
    if (!depth) return `🗂️ ${name}`;
    const indent = '\u00a0\u00a0'.repeat(Math.max(0, depth - 1));
    return `${indent}\u2066└─\u2069 🗂️ ${name}`;
}
