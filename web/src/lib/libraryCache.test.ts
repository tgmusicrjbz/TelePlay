import { describe, expect, it } from 'vitest';
import type { FileListResponse, Folder, TelegramFile } from './api';
import { moveFilesInList, moveFoldersInList, removeFilesFromList, removeFoldersFromList } from './libraryCache';

const file = (id: number, folderId: number | null): TelegramFile => ({
    id, user_id: 1, folder_id: folderId, file_id: `file-${id}`, file_unique_id: `unique-${id}`,
    file_name: `${id}.mp3`, description: null, file_size: 10, mime_type: 'audio/mpeg', file_type: 'audio',
    duration: 1, created_at: '', updated_at: '', tags: [],
});
const response = (files: TelegramFile[], total = files.length): FileListResponse => ({ files, total, page: 1, per_page: 50, search_mode: 'exact', suggestions: [] });
const folder = (id: number, parentId: number | null, children: Folder[] = []): Folder => ({ id, name: `folder-${id}`, description: null, parent_id: parentId, user_id: 1, created_at: '', updated_at: '', file_count: 0, children });

describe('library cache updates', () => {
    it('removes deleted files immediately and keeps server totals valid', () => {
        const next = removeFilesFromList(response([file(1, null), file(2, null)], 7), [2]);
        expect(next?.files.map(item => item.id)).toEqual([1]);
        expect(next?.total).toBe(6);
        expect(removeFilesFromList(next, [99])).toBe(next);
    });

    it('removes a moved file from its old folder while retaining it in broad lists', () => {
        const source = response([file(1, 10), file(2, 10)]);
        expect(moveFilesInList(source, [1], 20, 10)?.files.map(item => item.id)).toEqual([2]);
        const broad = moveFilesInList(source, [1], 20, undefined);
        expect(broad?.files[0].folder_id).toBe(20);
    });

    it('prunes deleted folders recursively and moves folders out of the old parent', () => {
        const nested = [folder(1, null, [folder(2, 1), folder(3, 1)])];
        expect(removeFoldersFromList(nested, [2])?.[0].children?.map(item => item.id)).toEqual([3]);
        expect(moveFoldersInList([folder(4, 1), folder(5, 1)], [4], 9, 1)?.map(item => item.id)).toEqual([5]);
    });
});
