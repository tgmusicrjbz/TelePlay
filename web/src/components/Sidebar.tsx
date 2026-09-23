import { Files, Clock, PlayCircle, LogOut, HardDrive, X, Users, Palette, FolderPlus, RotateCcw, ListMusic } from 'lucide-react';
import logo from '../assets/logo.png';
import { useAppStore } from '../lib/store';
import { useStorageStats, formatFileSize, useLogoutAll } from '../lib/api';
import { useEffect, useState } from 'react';

const colorThemes = {
    violet: { label: 'بنفش', dot: '#a855f7', shades: ['250 245 255','243 232 255','233 213 255','216 180 254','192 132 252','168 85 247','147 51 234','124 58 237','107 33 168','88 28 135','59 7 100'] },
    blue: { label: 'آبی', dot: '#3b82f6', shades: ['239 246 255','219 234 254','191 219 254','147 197 253','96 165 250','59 130 246','37 99 235','29 78 216','30 64 175','30 58 138','23 37 84'] },
    emerald: { label: 'زمردی', dot: '#10b981', shades: ['236 253 245','209 250 229','167 243 208','110 231 183','52 211 153','16 185 129','5 150 105','4 120 87','6 95 70','6 78 59','2 44 34'] },
    rose: { label: 'رز', dot: '#f43f5e', shades: ['255 241 242','255 228 230','254 205 211','253 164 175','251 113 133','244 63 94','225 29 72','190 18 60','159 18 57','136 19 55','76 5 25'] },
    amber: { label: 'کهربایی', dot: '#f59e0b', shades: ['255 251 235','254 243 199','253 230 138','252 211 77','251 191 36','245 158 11','217 119 6','180 83 9','146 64 14','120 53 15','69 26 3'] },
} as const;

type ColorTheme = keyof typeof colorThemes;

const applyTheme = (theme: ColorTheme) => {
    colorThemes[theme].shades.forEach((value, index) => {
        const shade = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950][index];
        document.documentElement.style.setProperty(`--primary-${shade}`, value);
    });
};

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
    const { activeSection, setActiveSection, setShowNewFolder, setSearchQuery, setFileTypeFilter } = useAppStore();
    const { data: storage } = useStorageStats();
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);
    const [theme, setTheme] = useState<ColorTheme>(() => {
        const saved = localStorage.getItem('komod-color-theme');
        return saved && saved in colorThemes ? saved as ColorTheme : 'violet';
    });
    const logoutAllMutation = useLogoutAll();

    useEffect(() => { applyTheme(theme); }, [theme]);

    const chooseTheme = (nextTheme: ColorTheme) => {
        setTheme(nextTheme);
        localStorage.setItem('komod-color-theme', nextTheme);
        applyTheme(nextTheme);
    };

    const handleLogout = () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
    };

    const handleLogoutAll = async () => {
        try {
            await logoutAllMutation.mutateAsync();
            handleLogout();
        } catch (error) {
            console.error('خروج از همه دستگاه‌ها انجام نشد', error);
            handleLogout();
        }
    };

    const handleNavClick = (section: 'files' | 'recent' | 'continue_watching' | 'playlists') => {
        setActiveSection(section);
        onClose();
    };

    const NavItem = ({ section, icon: Icon, label }: { section: 'files' | 'recent' | 'continue_watching' | 'playlists', icon: any, label: string }) => (
        <button
            onClick={() => handleNavClick(section)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                activeSection === section
                    ? 'bg-primary-600/10 text-primary-400 font-medium'
                    : 'text-dark-400 hover:text-white hover:bg-white/[0.05]'
            }`}
        >
            <Icon className="w-5 h-5" />
            {label}
        </button>
    );

    return (
        <>
            {/* لایه تیره موبایل */}
            <div 
                className={`fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm transition-opacity duration-300 ${
                    isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={onClose}
            />

            <aside className={`
                w-64 bg-dark-900 border-l border-white/[0.06] flex flex-col shrink-0
                fixed inset-y-0 right-0 z-40 text-right
                transition-transform duration-300 ease-in-out shadow-2xl
                ${isOpen ? 'translate-x-0' : 'translate-x-full'}
            `}>
                {/* Logo Area */}
                <div className="p-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <img 
                            src={logo} 
                            alt="لوگوی کمد"
                            className="w-8 h-8 rounded-lg shadow-lg shadow-primary-500/20 object-contain" 
                        />
                        <span className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
                            کمد
                        </span>
                    </div>
                    {/* بستن منو در موبایل */}
                    <button 
                        onClick={onClose}
                        className="md:hidden p-1 text-dark-400 hover:text-white"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
                    <NavItem section="files" icon={Files} label="فایل‌ها و کشوها" />
                    <NavItem section="playlists" icon={ListMusic} label="پلی‌لیست‌ها" />
                    <NavItem section="recent" icon={Clock} label="تازه اضافه‌شده‌ها" />
                    <NavItem section="continue_watching" icon={PlayCircle} label="ادامه پخش" />

                    <div className="pt-5 pb-2 px-2 text-xs font-semibold text-dark-500">⚡ دسترسی سریع</div>
                    <button onClick={() => { setActiveSection('files'); setShowNewFolder(true); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-dark-300 hover:text-white hover:bg-white/[0.05] transition-colors">
                        <FolderPlus className="h-5 w-5 text-primary-400" /> کشوی تازه
                    </button>
                    <button onClick={() => { setSearchQuery(''); setFileTypeFilter(null); setActiveSection('files'); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-dark-300 hover:text-white hover:bg-white/[0.05] transition-colors">
                        <RotateCcw className="h-5 w-5 text-primary-400" /> پاک‌کردن جست‌وجو و فیلتر
                    </button>
                </nav>

                <div className="mx-3 mb-2 rounded-xl border border-white/[0.06] bg-dark-800/40 p-3">
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-dark-300"><Palette className="h-4 w-4" /> رنگ کمد</div>
                    <div className="flex items-center justify-between gap-2">
                        {(Object.entries(colorThemes) as [ColorTheme, typeof colorThemes[ColorTheme]][]).map(([key, item]) => (
                            <button key={key} onClick={() => chooseTheme(key)} title={item.label} aria-label={`رنگ ${item.label}`} className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${theme === key ? 'scale-110 border-white shadow-lg' : 'border-transparent opacity-70 hover:opacity-100'}`} style={{ backgroundColor: item.dot }} />
                        ))}
                    </div>
                </div>

                {/* Storage Info */}
                <div className="p-4 m-3 rounded-xl bg-dark-800/50 border border-white/[0.04]">
                    <div className="flex items-center gap-2 mb-2 text-sm text-dark-300">
                        <HardDrive className="w-4 h-4" />
                        <span>فضای استفاده‌شده</span>
                    </div>
                    {storage ? (
                        <>
                            <div className="text-xl font-bold text-white mb-1">
                                {formatFileSize(storage.total_size)}
                            </div>
                            <div className="text-xs text-primary-400">
                                ذخیره‌شده در تلگرام 🚀
                            </div>
                        </>
                    ) : (
                        <div className="h-4 w-20 bg-dark-700 rounded animate-pulse" />
                    )}
                </div>

                {/* Logout */}
                <div className="p-4 border-t border-white/[0.06]">
                    <button
                        onClick={() => setShowLogoutConfirm(true)}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-dark-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                        <LogOut className="w-5 h-5" />
                        <span className="font-medium">خروج از این دستگاه</span>
                    </button>
                    <button
                        onClick={() => setShowLogoutAllConfirm(true)}
                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-dark-400 hover:text-orange-400 hover:bg-orange-500/10 transition-colors mt-1"
                    >
                        <Users className="w-5 h-5" />
                        <span className="font-medium">خروج از همه دستگاه‌ها</span>
                    </button>
                </div>
            </aside>

            {/* Logout Modal */}
            {showLogoutConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-dark-900 border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-scale-in">
                        <div className="p-6 text-center">
                            <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                <LogOut className="w-6 h-6 text-red-500" />
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-2">از کمد خارج می‌شی؟</h3>
                            <p className="text-dark-400 text-sm">
                                نشست این دستگاه بسته می‌شه و برای ورود دوباره به کد نیاز داری.
                            </p>
                        </div>
                        <div className="p-4 border-t border-white/5 flex gap-3 bg-dark-800/50">
                            <button
                                onClick={() => setShowLogoutConfirm(false)}
                                className="flex-1 px-4 py-2 rounded-lg text-dark-300 hover:bg-white/5 transition-colors font-medium"
                            >
                                بی‌خیال
                            </button>
                            <button
                                onClick={handleLogout}
                                className="flex-1 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors shadow-lg shadow-red-500/20"
                            >
                                خروج
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Logout All Modal */}
            {showLogoutAllConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-dark-900 border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-scale-in">
                        <div className="p-6 text-center">
                            <div className="w-12 h-12 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Users className="w-6 h-6 text-orange-500" />
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-2">خروج از همه دستگاه‌ها</h3>
                            <p className="text-dark-400 text-sm">
                                نشست کمد روی <strong>همه دستگاه‌ها</strong> بسته می‌شه. مطمئنی؟
                            </p>
                        </div>
                        <div className="p-4 border-t border-white/5 flex gap-3 bg-dark-800/50">
                            <button
                                onClick={() => setShowLogoutAllConfirm(false)}
                                className="flex-1 px-4 py-2 rounded-lg text-dark-300 hover:bg-white/5 transition-colors font-medium"
                            >
                                بی‌خیال
                            </button>
                            <button
                                onClick={handleLogoutAll}
                                className="flex-1 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors shadow-lg shadow-orange-500/20"
                                disabled={logoutAllMutation.isPending}
                            >
                                {logoutAllMutation.isPending ? 'در حال خروج…' : 'خروج از همه'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
