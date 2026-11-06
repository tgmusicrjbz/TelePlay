import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import YouTubeQualityPicker from './YouTubeQualityPicker';

const links = ['https://youtu.be/first', 'https://youtube.com/watch?v=second'];

describe('YouTubeQualityPicker', () => {
    it('stays hidden for a single YouTube link', () => {
        const { container } = render(<YouTubeQualityPicker links={[links[0]]} metadata={{}} loading={false} defaultQuality="480" values={{}} onChange={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows metadata and keeps a separate quality for each link', () => {
        const onChange = vi.fn();
        render(<YouTubeQualityPicker links={links} metadata={{ [links[0]]: { title: 'عنوان ویدیوی اول', author: 'کانال اول' } }} loading={false} defaultQuality="480" values={{ [links[1]]: '720' }} onChange={onChange} />);
        expect(screen.getByText('عنوان ویدیوی اول')).toBeInTheDocument();
        expect(screen.getByText('۲ لینک')).toBeInTheDocument();
        const second1080Button = screen.getAllByRole('button', { name: '1080p' })[1];
        fireEvent.click(second1080Button);
        expect(onChange).toHaveBeenCalledWith(links[1], '1080');
        expect(screen.getAllByRole('button', { name: '720p' })[1]).toHaveAttribute('aria-pressed', 'true');
    });
});
