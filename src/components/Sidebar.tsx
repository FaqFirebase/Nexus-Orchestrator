import { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Plus, MessageSquare, Trash2, Lock, Pencil } from 'lucide-react';
import type { Conversation } from '../types';
import { VERSION } from '../constants';

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
}

export default function Sidebar({
  conversations,
  activeConversationId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditValue(conv.title || '');
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRenameConversation(editingId, editValue);
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditingId(null);
  };

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 280, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className="border-r border-zinc-800 bg-black/20 backdrop-blur-sm flex flex-col overflow-hidden z-40"
    >
      <div className="p-4 border-b border-zinc-800">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white transition-all group"
        >
          <Plus className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          New Orchestration
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {conversations.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-20 text-center p-4">
            <MessageSquare className="w-8 h-8 mb-2" />
            <p className="text-[10px] font-mono uppercase tracking-widest">No history found</p>
          </div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              onDoubleClick={(e) => startRename(conv, e)}
              className={`group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${
                activeConversationId === conv.id
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-white'
                  : 'hover:bg-zinc-900/50 border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <MessageSquare className={`w-4 h-4 shrink-0 ${activeConversationId === conv.id ? 'text-emerald-500' : 'text-zinc-600'}`} />
              <div className="flex-1 min-w-0">
                {editingId === conv.id ? (
                  <input
                    ref={editInputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-zinc-800 border border-emerald-500/30 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-tight text-white outline-none"
                  />
                ) : (
                  <p className="text-[11px] font-bold truncate uppercase tracking-tight">
                    {conv.title || 'Untitled Session'}
                  </p>
                )}
                <p className="text-[9px] font-mono opacity-40">
                  {new Date(conv.updatedAt).toLocaleDateString()}
                </p>
              </div>
              {editingId !== conv.id && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => startRename(conv, e)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-zinc-700/50 hover:text-white rounded-lg transition-all"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => onDeleteConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 hover:text-red-500 rounded-lg transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-zinc-800 bg-black/40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <Lock className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-zinc-400 truncate uppercase tracking-widest">Admin Session</p>
            <p className="text-[8px] font-mono text-zinc-600 truncate">Nexus Orchestrator v{VERSION}</p>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
