import { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import type { Project } from '../../types';

interface ProjectRowProps {
  project: Project;
  onToggleCollapsed: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, deleteChats: boolean) => void;
  children: React.ReactNode;
}

export default function ProjectRow({ project, onToggleCollapsed, onRename, onDelete, children }: ProjectRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(project.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitRename = () => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== project.name) onRename(project.id, trimmed);
    else setEditValue(project.name);
  };

  return (
    <div>
      {/* Project header row */}
      <div
        className="group flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-zinc-800/50 cursor-pointer select-none"
        onClick={() => !editing && onToggleCollapsed(project.id)}
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditValue(project.name); }}
      >
        {project.collapsed
          ? <ChevronRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
          : <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
        }

        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setEditing(false); setEditValue(project.name); } }}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-zinc-800 border border-emerald-500/50 rounded px-1.5 py-0.5 text-xs text-zinc-200 focus:outline-none font-mono"
          />
        ) : (
          <span className="flex-1 text-xs font-semibold text-zinc-400 uppercase tracking-wider truncate">
            {project.name}
          </span>
        )}

        {!editing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); setEditing(true); setEditValue(project.name); }}
              className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); setShowDeleteDialog(true); }}
              className="p-0.5 text-zinc-600 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Children (conversation rows) */}
      {!project.collapsed && (
        <div className="ml-4 border-l border-zinc-800 pl-1">
          {children}
        </div>
      )}

      {/* Delete confirm dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-zinc-200 mb-1">Delete "{project.name}"?</p>
            <p className="text-xs text-zinc-500 mb-4">Choose what happens to the conversations inside.</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowDeleteDialog(false); onDelete(project.id, false); }}
                className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg hover:border-zinc-500 text-zinc-300 transition-colors text-left"
              >
                Delete project only — move chats to unassigned
              </button>
              <button
                onClick={() => { setShowDeleteDialog(false); onDelete(project.id, true); }}
                className="w-full px-3 py-2 text-xs bg-red-950/50 border border-red-800/50 rounded-lg hover:border-red-600 text-red-400 transition-colors text-left"
              >
                Delete project and all chats inside
              </button>
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="w-full px-3 py-2 text-xs bg-transparent border border-zinc-800 rounded-lg hover:border-zinc-600 text-zinc-500 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
