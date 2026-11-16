import { beforeEach, describe, expect, it } from 'vitest';
import type { TelegramFile } from './api';
import { useAppStore } from './store';

const media = (id: number): TelegramFile => ({
    id,
    file_name: `track-${id}.mp3`,
    file_type: 'audio',
    stream_url: `/files/${id}/stream`,
} as TelegramFile);

describe('player store', () => {
    beforeEach(() => {
        useAppStore.setState({
            autoAdvance: false,
            playQueue: [],
            queueIndex: -1,
            previewFile: null,
        });
    });

    it('enables continuous playback whenever a multi-item queue starts', () => {
        useAppStore.getState().startQueue([media(1), media(2)], 0);

        expect(useAppStore.getState().autoAdvance).toBe(true);
        expect(useAppStore.getState().playNext()).toBe(true);
        expect(useAppStore.getState().queueIndex).toBe(1);
        expect(useAppStore.getState().previewFile?.id).toBe(2);
    });

    it('keeps the active track and enables continuation when shuffling', () => {
        useAppStore.getState().startQueue([media(1), media(2), media(3)], 1);
        useAppStore.setState({ autoAdvance: false });
        useAppStore.getState().shuffleQueue();

        const state = useAppStore.getState();
        expect(state.autoAdvance).toBe(true);
        expect(state.queueIndex).toBe(0);
        expect(state.previewFile?.id).toBe(2);
        expect(state.playQueue[0].id).toBe(2);
    });
});
