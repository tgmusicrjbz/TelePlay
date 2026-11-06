export type SpeechJobState =
    | 'queued'
    | 'paused'
    | 'downloading'
    | 'transcribing'
    | 'synthesizing'
    | 'merging'
    | 'uploading'
    | 'saving'
    | 'done'
    | 'error'
    | 'cancelled';

export interface STTSourceFile {
    id: number;
    file_name: string;
}

export interface STTJobPayload {
    file_id: number;
    title: string;
    prompt: string;
    post_prompts: string[];
    folder_id: number | null;
    output_mode: 'temporary' | 'save';
}

interface BuildSTTJobPayloadsOptions {
    selectedFileIds: Iterable<number>;
    files: STTSourceFile[];
    singleTitle: string;
    titlesByFileId: Record<number, string>;
    prompt: string;
    postPrompts: string[];
    outputMode: 'temporary' | 'save';
    folder: string;
}

const FINISHED_STATES = new Set<SpeechJobState>(['done', 'error', 'cancelled']);

export function isFinishedSpeechJob(state: SpeechJobState): boolean {
    return FINISHED_STATES.has(state);
}

export function clampSpeechProgress(progress: number | null | undefined): number {
    const value = Number(progress);
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
}

export function stripFileExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '');
}

export function defaultSTTTitle(fileName: string): string {
    return `📝 متن ${stripFileExtension(fileName)}`;
}

export function buildSTTJobPayloads({
    selectedFileIds,
    files,
    singleTitle,
    titlesByFileId,
    prompt,
    postPrompts,
    outputMode,
    folder,
}: BuildSTTJobPayloadsOptions): STTJobPayload[] {
    const ids = [...selectedFileIds];
    const filesById = new Map(files.map(file => [file.id, file]));
    const normalizedPrompt = prompt.trim();
    const normalizedPostPrompts = postPrompts.map(item => item.trim()).filter(Boolean);
    const folderId = outputMode === 'save' && folder !== 'default' ? Number(folder) : null;

    return ids.map(fileId => {
        const sourceName = filesById.get(fileId)?.file_name || `فایل ${fileId}`;
        const requestedTitle = ids.length === 1 ? singleTitle : titlesByFileId[fileId];
        return {
            file_id: fileId,
            title: requestedTitle?.trim() || defaultSTTTitle(sourceName),
            prompt: normalizedPrompt,
            post_prompts: [...normalizedPostPrompts],
            folder_id: Number.isFinite(folderId) ? folderId : null,
            output_mode: outputMode,
        };
    });
}
