import { Cpu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ConnectionStatus } from '../types';

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  activeTab: 'chat' | 'models' | 'system';
  setActiveTab: (tab: 'chat' | 'models' | 'system') => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (v: boolean) => void;
}

export default function Header({ connectionStatus, activeTab, setActiveTab, isSidebarOpen, setIsSidebarOpen }: HeaderProps) {
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
        </div>
      </div>
    </header>
  );
}
