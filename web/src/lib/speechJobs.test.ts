import { describe, expect, it } from 'vitest';
import { buildSTTJobPayloads, clampSpeechProgress, defaultSTTTitle, isFinishedSpeechJob } from './speechJobs';

describe('speech job helpers', () => {
    it('builds one independent STT request per selected file', () => {
        const payloads = buildSTTJobPayloads({
            selectedFileIds: new Set([12, 34]),
            files: [
                { id: 12, file_name: 'جلسه اول.mp3' },
                { id: 34, file_name: 'meeting.final.mp4' },
            ],
            singleTitle: 'ignored for multiple files',
            titlesByFileId: { 12: 'رونویسی جلسه', 34: 'Meeting notes' },
            prompt: '  گوینده‌ها را جدا کن  ',
            postPrompts: [' خلاصه کن ', '', '  نکته‌ها را استخراج کن '],
            outputMode: 'save',
            folder: '81',
        });

        expect(payloads).toEqual([
            {
                file_id: 12,
                title: 'رونویسی جلسه',
                prompt: 'گوینده‌ها را جدا کن',
                post_prompts: ['خلاصه کن', 'نکته‌ها را استخراج کن'],
                folder_id: 81,
                output_mode: 'save',
            },
            {
                file_id: 34,
                title: 'Meeting notes',
                prompt: 'گوینده‌ها را جدا کن',
                post_prompts: ['خلاصه کن', 'نکته‌ها را استخراج کن'],
                folder_id: 81,
                output_mode: 'save',
            },
        ]);
        expect(payloads[0].post_prompts).not.toBe(payloads[1].post_prompts);
    });

    it('uses a per-file fallback title and no folder for temporary output', () => {
        const [payload] = buildSTTJobPayloads({
            selectedFileIds: [7],
            files: [{ id: 7, file_name: 'voice.note.v2.ogg' }],
            singleTitle: '   ',
            titlesByFileId: {},
            prompt: '',
            postPrompts: [],
            outputMode: 'temporary',
            folder: '99',
        });

        expect(payload.title).toBe('📝 متن voice.note.v2');
        expect(payload.folder_id).toBeNull();
    });

    it('normalizes job progress and terminal states', () => {
        expect(clampSpeechProgress(-12)).toBe(0);
        expect(clampSpeechProgress(45.5)).toBe(45.5);
        expect(clampSpeechProgress(140)).toBe(100);
        expect(clampSpeechProgress(Number.NaN)).toBe(0);
        expect(isFinishedSpeechJob('done')).toBe(true);
        expect(isFinishedSpeechJob('cancelled')).toBe(true);
        expect(isFinishedSpeechJob('transcribing')).toBe(false);
        expect(defaultSTTTitle('recording.mp3')).toBe('📝 متن recording');
    });
});
