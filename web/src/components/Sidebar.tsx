import { Files, Clock, PlayCircle, LogOut, HardDrive, X, Users } from 'lucide-react';
import logo from '../assets/logo.png';
import { useAppStore } from '../lib/store';
import { useStorageStats, formatFileSize, useLogoutAll } from '../lib/api';
import { useState } from 'react';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
    const { activeSection, setActiveSection } = useAppStore();
    const { data: storage } = useStorageStats();
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);
    const logoutAllMutation = useLogoutAll();

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

    const handleNavClick = (section: 'files' | 'recent' | 'continue_watching') => {
        setActiveSection(section);
        onClose();
    };

    const NavItem = ({ section, icon: Icon, label }: { section: 'files' | 'recent' | 'continue_watching', icon: any, label: string }) => (
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
                    <NavItem section="recent" icon={Clock} label="تازه اضافه‌شده‌ها" />
                    <NavItem section="continue_watching" icon={PlayCircle} label="ادامه پخش" />
                </nav>

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
