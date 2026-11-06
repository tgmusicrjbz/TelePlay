export type PlayerRepeatMode = 'off' | 'all' | 'one';

export function nextQueueIndex(length: number, currentIndex: number, repeatMode: PlayerRepeatMode): number | null {
    if (length <= 0) return null;
    const next = currentIndex + 1;
    if (next < length) return next;
    return repeatMode === 'all' ? 0 : null;
}

export function previousQueueIndex(length: number, currentIndex: number, repeatMode: PlayerRepeatMode): number | null {
    if (length <= 0) return null;
    const previous = currentIndex - 1;
    if (previous >= 0) return previous;
    return repeatMode === 'all' ? length - 1 : null;
}

export function moveQueueEntry<T>(queue: T[], from: number, to: number, currentIndex: number): { queue: T[]; currentIndex: number } | null {
    if (from < 0 || to < 0 || from >= queue.length || to >= queue.length || from === to) return null;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    let nextCurrentIndex = currentIndex;
    if (from === currentIndex) nextCurrentIndex = to;
    else if (from < currentIndex && to >= currentIndex) nextCurrentIndex -= 1;
    else if (from > currentIndex && to <= currentIndex) nextCurrentIndex += 1;
    return { queue: next, currentIndex: nextCurrentIndex };
}
