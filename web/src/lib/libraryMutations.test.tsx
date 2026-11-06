import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, FileListResponse, TelegramFile, useDeleteFile, useUpdateFile } from './api';
import { markServerReachable } from './connectivity';

const file = (id: number): TelegramFile => ({
    id, user_id: 1, folder_id: null, file_id: `file-${id}`, file_unique_id: `unique-${id}`,
    file_name: `${id}.mp3`, description: null, file_size: 10, mime_type: 'audio/mpeg', file_type: 'audio',
    duration: 1, created_at: '', updated_at: '', tags: [],
});
const list = (): FileListResponse => ({ files: [file(1), file(2)], total: 2, page: 1, per_page: 50, search_mode: 'exact', suggestions: [] });

describe('library mutations', () => {
    it('removes a file before the request finishes', async () => {
        const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
        const key = ['files', null, undefined, undefined, 1, '', false, false, false, false, false] as const;
        client.setQueryData(key, list());
        let finish!: () => void;
        vi.spyOn(api, 'delete').mockReturnValue(new Promise(resolve => { finish = () => resolve({data:{}} as never); }));
        const wrapper = ({children}:{children:ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const {result} = renderHook(() => useDeleteFile(), {wrapper});

        let request!: Promise<number>;
        act(() => { request = result.current.mutateAsync(2); });
        await waitFor(() => expect(client.getQueryData<FileListResponse>(key)?.files.map(item => item.id)).toEqual([1]));
        finish();
        await act(async () => { await request; });
    });

    it('restores the previous cache when deletion fails', async () => {
        const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
        const key = ['files', null, undefined, undefined, 1, '', false, false, false, false, false] as const;
        client.setQueryData(key, list());
        vi.spyOn(api, 'delete').mockRejectedValue(new Error('network failed'));
        const wrapper = ({children}:{children:ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const {result} = renderHook(() => useDeleteFile(), {wrapper});

        await act(async () => { await expect(result.current.mutateAsync(2)).rejects.toThrow('network failed'); });
        expect(client.getQueryData<FileListResponse>(key)?.files.map(item => item.id)).toEqual([1, 2]);
    });

    it('shows metadata edits immediately and rolls them back on failure', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        markServerReachable();
        const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
        const key = ['files', null, undefined, undefined, 1, '', false, false, false, false, false] as const;
        client.setQueryData(key, list());
        let fail!: () => void;
        vi.spyOn(api, 'patch').mockReturnValue(new Promise((_resolve, reject) => {
            fail = () => reject(Object.assign(new Error('save failed'), { response: { status: 500 } }));
        }));
        const wrapper = ({children}:{children:ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const {result} = renderHook(() => useUpdateFile(), {wrapper});

        let request!:Promise<TelegramFile>;
        act(()=>{request=result.current.mutateAsync({id:2,is_blurred:true,file_name:'نام تازه.mp3'})});
        await waitFor(()=>expect(client.getQueryData<FileListResponse>(key)?.files[1]).toMatchObject({is_blurred:true,file_name:'نام تازه.mp3'}));
        fail();
        await act(async()=>{await expect(request).rejects.toThrow('save failed')});
        expect(client.getQueryData<FileListResponse>(key)?.files[1]).toMatchObject({file_name:'2.mp3'});
        expect(client.getQueryData<FileListResponse>(key)?.files[1].is_blurred).toBeFalsy();
    });
});
