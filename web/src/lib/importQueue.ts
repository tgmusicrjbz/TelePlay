export type ImportPlatform = 'youtube' | 'instagram' | 'pinterest';

export type ImportStatus = {
    id: string;
    source: 'link' | 'drive';
    url: string;
    title?: string;
    author?: string;
    quality?: string;
    folder_id?: number | null;
    created_at?: string;
    state: 'queued' | 'downloading' | 'saving' | 'paused' | 'cancelled' | 'done' | 'error';
    message: string;
    saved?: number;
    progress?: number;
};

export function classifyImportUrl(raw: string): ImportPlatform | null {
    try {
        const parsed = new URL(raw);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
        if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
        if (host === 'pin.it' || host === 'pinterest.com' || host.endsWith('.pinterest.com')) return 'pinterest';
    } catch {
        // The input can be incomplete while the user is typing.
    }
    return null;
}

export function compactImportTitle(value: string, max = 72) {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function importSourceLabel(job: Pick<ImportStatus, 'source' | 'url' | 'title'>) {
    if (job.title) return compactImportTitle(job.title);
    if (job.source === 'drive') return 'گوگل درایو';
    const platform = classifyImportUrl(job.url);
    return platform === 'youtube' ? 'یوتیوب'
        : platform === 'pinterest' ? 'پینترست'
            : platform === 'instagram' ? 'اینستاگرام'
                : 'لینک';
}

export function mergeImportStatuses(current: ImportStatus[], incoming: ImportStatus[]) {
    const merged = new Map<string, ImportStatus>();
    current.forEach(item => merged.set(item.id, item));
    incoming.forEach(item => merged.set(item.id, { ...merged.get(item.id), ...item }));
    return Array.from(merged.values());
}

export function visibleImportStatuses(jobs: ImportStatus[], dismissedIds: ReadonlySet<string>) {
    return jobs.filter(job => !dismissedIds.has(job.id));
}
