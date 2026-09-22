import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { api, canPreviewText } from '../lib/api';
import { useAppStore } from '../lib/store';

export default function ContentPreview() {
    const { previewFile: file, setPreviewFile } = useAppStore();
    const [content, setContent] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const show = !!file && (file.file_type === 'image' || canPreviewText(file));

    useEffect(() => {
        if (!show || !file || file.file_type === 'image') return;
        let cancelled = false;
        setLoading(true);
        setContent('');
        setError('');
        api.get<{ content: string }>(`/files/${file.id}/text`)
            .then(({ data }) => { if (!cancelled) setContent(data.content); })
            .catch((err) => { if (!cancelled) setError(err.response?.data?.detail || 'Could not load text.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [file?.id, show]);

    useEffect(() => {
        if (!show) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setPreviewFile(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [show, setPreviewFile]);

    if (!file || !show) return null;
    const token = localStorage.getItem('access_token');
    const url = `${file.stream_url}?token=${encodeURIComponent(token || '')}`;

    return (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md p-3 sm:p-8 flex items-center justify-center" onClick={() => setPreviewFile(null)}>
            <section className="w-full max-w-5xl max-h-full flex flex-col rounded-2xl border border-white/10 bg-dark-900 shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
                <header className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
                    <h2 className="flex-1 min-w-0 truncate font-semibold" title={file.file_name}>{file.file_name}</h2>
                    <a href={`${url}&download=1`} download={file.file_name} className="btn-icon" title="Download"><Download className="w-5 h-5" /></a>
                    <button onClick={() => setPreviewFile(null)} className="btn-icon" title="Close"><X className="w-5 h-5" /></button>
                </header>
                {file.file_type === 'image' ? (
                    <div className="min-h-0 flex-1 flex items-center justify-center p-4 overflow-auto">
                        <img src={url} alt={file.file_name} className="max-w-full max-h-[75vh] object-contain rounded-lg" />
                    </div>
                ) : (
                    <div className="min-h-0 overflow-auto p-5 sm:p-8 bg-dark-950/60">
                        {loading ? <p className="text-dark-400">Loading text...</p> : error ? <p className="text-red-400">{error}</p> :
                            <pre dir="auto" className="whitespace-pre-wrap break-words font-mono text-sm leading-7 text-dark-100">{content}</pre>}
                    </div>
                )}
            </section>
        </div>
    );
}
