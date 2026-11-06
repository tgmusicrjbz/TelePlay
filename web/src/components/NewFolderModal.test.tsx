import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewFolderModal from './NewFolderModal';

const mutateAsync=vi.fn();
const addToast=vi.fn();

vi.mock('../lib/api',()=>({
    useCreateFolder:()=>({mutateAsync,isPending:false}),
}));
vi.mock('../lib/store',()=>({
    useAppStore:(selector:(state:{addToast:typeof addToast})=>unknown)=>selector({addToast}),
}));

describe('NewFolderModal',()=>{
    beforeEach(()=>{mutateAsync.mockReset();addToast.mockReset();mutateAsync.mockReturnValue(new Promise(()=>undefined))});

    it('closes immediately and continues folder creation in the background',()=>{
        const onClose=vi.fn();
        render(<NewFolderModal parentId={12} onClose={onClose}/>);
        fireEvent.change(screen.getByPlaceholderText('نام کشو'),{target:{value:'  سفر  '}});
        fireEvent.change(screen.getByPlaceholderText('توضیحات کشو (اختیاری)'),{target:{value:' عکس‌ها '}});
        fireEvent.click(screen.getByRole('button',{name:'ساخت کشو'}));

        expect(onClose).toHaveBeenCalledOnce();
        expect(mutateAsync).toHaveBeenCalledWith({name:'سفر',description:'عکس‌ها',parent_id:12});
        expect(addToast).toHaveBeenCalledWith('ساخت کشوی تازه در پس‌زمینه شروع شد…','info');
    });
});
