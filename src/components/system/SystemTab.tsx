import { Database, Settings, MessageSquare, RefreshCw } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { NexusConfig, Conversation } from '../../types';

interface SystemTabProps {
  config: NexusConfig;
  conversations: Conversation[];
  fetchConversations: () => void;
}

export default function SystemTab({ config, conversations, fetchConversations }: SystemTabProps) {
  const downloadJson = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  return (
    <div className="pb-32 scroll-smooth">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white uppercase tracking-tighter">System Data</h2>
              <p className="text-[10px] font-mono text-zinc-500 uppercase">Database Inspection & Export</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchConversations}
              className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-8">
          {/* Config JSON */}
          <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-400" />
                <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Configuration</h3>
              </div>
              <button
                onClick={() => downloadJson(config, 'config.json')}
                className="text-[10px] font-bold text-blue-400 uppercase tracking-widest hover:text-blue-300 transition-colors"
              >
                Export JSON
              </button>
            </div>
            <div className="relative group">
              <div className="max-h-[300px] overflow-y-auto rounded-xl bg-black/60 border border-zinc-800 p-4">
                <SyntaxHighlighter
                  language="json"
                  style={vscDarkPlus}
                  customStyle={{ background: 'transparent', padding: 0, fontSize: '11px' }}
                >
                  {JSON.stringify(config, null, 2)}
                </SyntaxHighlighter>
              </div>
            </div>
          </div>

          {/* Conversations JSON */}
          <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest">Conversations</h3>
              </div>
              <button
                onClick={() => downloadJson(conversations, 'conversations.json')}
                className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest hover:text-emerald-300 transition-colors"
              >
                Export JSON
              </button>
            </div>
            <div className="relative group">
              <div className="max-h-[500px] overflow-y-auto rounded-xl bg-black/60 border border-zinc-800 p-4">
                <SyntaxHighlighter
                  language="json"
                  style={vscDarkPlus}
                  customStyle={{ background: 'transparent', padding: 0, fontSize: '11px' }}
                >
                  {JSON.stringify(conversations, null, 2)}
                </SyntaxHighlighter>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
