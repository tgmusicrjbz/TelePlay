import { describe, expect, it } from 'vitest';
import { classifyImportUrl, compactImportTitle, importSourceLabel, mergeImportStatuses, visibleImportStatuses, type ImportStatus } from './importQueue';

const job = (overrides: Partial<ImportStatus> = {}): ImportStatus => ({
    id: 'job-1',
    source: 'link',
    url: 'https://youtu.be/example',
    state: 'queued',
    message: 'در صف',
    ...overrides,
});

describe('import queue', () => {
    it('recognizes supported platforms without mislabeling Pinterest as Instagram', () => {
        expect(classifyImportUrl('https://youtube.com/watch?v=1')).toBe('youtube');
        expect(classifyImportUrl('https://www.instagram.com/reel/1')).toBe('instagram');
        expect(classifyImportUrl('https://pin.it/example')).toBe('pinterest');
        expect(classifyImportUrl('javascript:alert(1)')).toBeNull();
    });

    it('keeps status titles compact and readable', () => {
        expect(compactImportTitle('  یک   عنوان   مرتب  ')).toBe('یک عنوان مرتب');
        expect(compactImportTitle('abcdefgh', 6)).toBe('abcde…');
        expect(importSourceLabel(job({ url: 'https://pin.it/example' }))).toBe('پینترست');
    });

    it('merges server updates without losing existing metadata', () => {
        const merged = mergeImportStatuses(
            [job({ title: 'عنوان ویدیو', progress: 10 })],
            [job({ state: 'downloading', message: 'در حال دریافت', progress: 60 })],
        );
        expect(merged).toEqual([expect.objectContaining({ title: 'عنوان ویدیو', state: 'downloading', progress: 60 })]);
    });

    it('does not restore dismissed jobs on the next server sync', () => {
        const serverJobs = [job(), job({ id: 'job-2', url: 'https://instagram.com/reel/2' })];
        expect(visibleImportStatuses(serverJobs, new Set(['job-1']))).toEqual([expect.objectContaining({ id: 'job-2' })]);
    });
});
