import { useState, useRef, useEffect } from 'react';
import { Cpu, PanelLeftClose, PanelLeftOpen, User, LogOut, KeyRound, ChevronDown } from 'lucide-react';
import type { ConnectionStatus, User as UserType } from '../types';

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  activeTab: 'chat' | 'models' | 'system';
  setActiveTab: (tab: 'chat' | 'models' | 'system') => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (v: boolean) => void;
  user: UserType | null;
  onLogout: () => void;
  onChangePassword: () => void;
}

export default function Header({ connectionStatus, activeTab, setActiveTab, isSidebarOpen, setIsSidebarOpen, user, onLogout, onChangePassword }: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showUserMenu]);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-black/50 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-colors"
          >
            {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          </button>
          <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <Cpu className="w-5 h-5 text-black" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tighter text-white uppercase">Nexus</h1>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono text-emerald-500/80 uppercase">System Active</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-zinc-900/50 rounded-full border border-zinc-800">
            <div className={`w-1.5 h-1.5 rounded-full ${
              connectionStatus.status === 'connected' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
              connectionStatus.status === 'checking' ? 'bg-amber-500 animate-pulse' :
              'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
            }`} />
            <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">
              {connectionStatus.status === 'connected' ? 'Local: Online' :
               connectionStatus.status === 'checking' ? 'Checking...' :
               'Local: Offline'}
            </span>
          </div>

          <nav className="flex items-center gap-1 p-1 bg-zinc-900/50 rounded-lg border border-zinc-800">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'chat' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Terminal
            </button>
            <button
              onClick={() => setActiveTab('models')}
              className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'models' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Models
            </button>
            <button
              onClick={() => setActiveTab('system')}
              className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'system' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              System
            </button>
          </nav>

          {/* User menu */}
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
              >
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <User className="w-3 h-3 text-emerald-500" />
                </div>
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider hidden sm:inline">
                  {user.username}
                </span>
                {user.role === 'admin' && (
                  <span className="text-[8px] font-bold text-amber-500 uppercase tracking-widest hidden sm:inline">Admin</span>
                )}
                <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-[60]">
                  <div className="px-4 py-3 border-b border-zinc-800">
                    <p className="text-xs font-bold text-zinc-200">{user.username}</p>
                    <p className="text-[10px] text-zinc-500 capitalize">{user.role}</p>
                  </div>
                  <button
                    onClick={() => { setShowUserMenu(false); onChangePassword(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Change Password
                  </button>
                  <button
                    onClick={() => { setShowUserMenu(false); onLogout(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
