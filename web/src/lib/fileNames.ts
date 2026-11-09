export function withoutFileExtension(fileName: string) {
    const trimmed = fileName.trim();
    const displayName = trimmed.replace(/\.[^./\\]+$/u, '').trim();
    return displayName || trimmed;
}
