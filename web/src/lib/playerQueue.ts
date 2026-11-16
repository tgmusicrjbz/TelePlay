export type PlayerRepeatMode = 'off' | 'all' | 'one';

export function shuffleItems<T>(items: T[], random: () => number = Math.random): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const target = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    // A valid Fisher-Yates shuffle can occasionally return the same order. For
    // a UI action that looks broken, so make one harmless rotation in that case.
    if (shuffled.length > 1 && shuffled.every((item, index) => item === items[index])) {
        shuffled.push(shuffled.shift() as T);
    }
    return shuffled;
}

export function shuffleRemainingQueue<T>(queue: T[], currentIndex: number, random: () => number = Math.random): { queue: T[]; currentIndex: number } {
    if (!queue.length) return { queue: [], currentIndex: -1 };
    const safeIndex = Math.min(Math.max(currentIndex, 0), queue.length - 1);
    const current = queue[safeIndex];
    const remaining = queue.filter((_, index) => index !== safeIndex);
    return { queue: [current, ...shuffleItems(remaining, random)], currentIndex: 0 };
}

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
