import type { FileListResponse, Folder } from './api';

export function removeFilesFromList(current: FileListResponse | undefined, ids: Iterable<number>): FileListResponse | undefined {
    if (!current) return current;
    const removed = new Set(ids);
    const files = current.files.filter(file => !removed.has(file.id));
    if (files.length === current.files.length) return current;
    return { ...current, files, total: Math.max(0, current.total - (current.files.length - files.length)) };
}

export function moveFilesInList(
    current: FileListResponse | undefined,
    ids: Iterable<number>,
    targetFolderId: number | null,
    listedFolderId: unknown,
    allLevels = false,
): FileListResponse | undefined {
    if (!current) return current;
    const moved = new Set(ids);
    const retainsMovedFiles = allLevels || listedFolderId === undefined || listedFolderId === targetFolderId || typeof listedFolderId === 'string';
    if (retainsMovedFiles) {
        return { ...current, files: current.files.map(file => moved.has(file.id) ? { ...file, folder_id: targetFolderId } : file) };
    }
    return removeFilesFromList(current, moved);
}

export function removeFoldersFromList(current: Folder[] | undefined, ids: Iterable<number>): Folder[] | undefined {
    if (!current) return current;
    const removed = new Set(ids);
    const prune = (folders: Folder[]): Folder[] => folders
        .filter(folder => !removed.has(folder.id))
        .map(folder => folder.children?.length ? { ...folder, children: prune(folder.children) } : folder);
    return prune(current);
}

export function moveFoldersInList(
    current: Folder[] | undefined,
    ids: Iterable<number>,
    targetFolderId: number | null,
    listedParentId: unknown,
): Folder[] | undefined {
    if (!current) return current;
    const moved = new Set(ids);
    if (listedParentId === targetFolderId || listedParentId === undefined) {
        return current.map(folder => moved.has(folder.id) ? { ...folder, parent_id: targetFolderId } : folder);
    }
    return current.filter(folder => !moved.has(folder.id));
}
