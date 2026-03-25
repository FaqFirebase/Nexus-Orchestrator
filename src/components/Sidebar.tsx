import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Plus, MessageSquare, Trash2, Lock, Pencil, FolderPlus, ChevronDown, ChevronRight } from 'lucide-react';
import type { Conversation, Project } from '../types';
import { VERSION } from '../constants';
import ProjectRow from './sidebar/ProjectRow';

interface ContextMenu {
  x: number;
  y: number;
  convId: string;
  showProjectSub: boolean;
}

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  onNavigateToChat?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  projects: Project[];
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string, deleteChats: boolean) => void;
  onToggleProjectCollapsed: (id: string) => void;
  onAssignConversationToProject: (convId: string, projectId: string | null) => void;
}

export default function Sidebar({
  conversations,
  activeConversationId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onNavigateToChat,
  onLoadMore,
  hasMore,
  projects,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onToggleProjectCollapsed,
  onAssignConversationToProject,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (showNewProjectModal) {
      setTimeout(() => newProjectInputRef.current?.focus(), 50);
    }
  }, [showNewProjectModal]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  const startRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditValue(conv.title || '');
    setContextMenu(null);
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

  const handleContextMenu = (e: React.MouseEvent, convId: string) => {
    e.preventDefault();
    const MENU_WIDTH = 216;
    const sidebarRight = sidebarRef.current?.getBoundingClientRect().right ?? e.clientX + MENU_WIDTH;
    const x = Math.min(e.clientX, sidebarRight - MENU_WIDTH - 4);
    setContextMenu({ x, y: e.clientY, convId, showProjectSub: false });
  };

  const handleCreateProject = useCallback(() => {
    setNewProjectName('');
    setShowNewProjectModal(true);
  }, []);

  const submitNewProject = () => {
    const trimmed = newProjectName.trim();
    if (trimmed) onCreateProject(trimmed);
    setShowNewProjectModal(false);
    setNewProjectName('');
  };

  const unassignedConvs = conversations.filter(c => !c.projectId);

  const ConvRow = ({ conv }: { conv: Conversation }) => (
    <div
      key={conv.id}
      onClick={() => { onSelectConversation(conv.id); onNavigateToChat?.(); }}
      onDoubleClick={(e) => startRename(conv, e)}
      onContextMenu={(e) => handleContextMenu(e, conv.id)}
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
  );

  return (
    <motion.aside
      ref={sidebarRef}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 280, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className="border-r border-zinc-800 bg-black/20 backdrop-blur-sm flex flex-col overflow-hidden z-40"
    >
      <div className="p-4 border-b border-zinc-800">
        <button
          onClick={() => { onNewConversation(); onNavigateToChat?.(); }}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white transition-all group"
        >
          <Plus className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          New Orchestration
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Projects section */}
        {projects.length > 0 && (
          <div className="mb-2">
            <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Projects</p>
            {projects.map(project => (
              <ProjectRow
                key={project.id}
                project={project}
                onToggleCollapsed={onToggleProjectCollapsed}
                onRename={onRenameProject}
                onDelete={onDeleteProject}
              >
                {conversations.filter(c => c.projectId === project.id).map(conv => (
                  <ConvRow key={conv.id} conv={conv} />
                ))}
                {conversations.filter(c => c.projectId === project.id).length === 0 && (
                  <p className="px-3 py-2 text-[9px] font-mono text-zinc-700">No chats yet</p>
                )}
              </ProjectRow>
            ))}
          </div>
        )}

        {/* New Project button */}
        <button
          onClick={handleCreateProject}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600 hover:text-emerald-400 transition-colors rounded-lg hover:bg-zinc-900/50"
        >
          <FolderPlus className="w-3 h-3" />
          New Project
        </button>

        {/* Divider before unassigned conversations */}
        {projects.length > 0 && unassignedConvs.length > 0 && (
          <div className="border-t border-zinc-800 my-2" />
        )}

        {/* Unassigned conversations */}
        {unassignedConvs.length === 0 && projects.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-20 text-center p-4">
            <MessageSquare className="w-8 h-8 mb-2" />
            <p className="text-[10px] font-mono uppercase tracking-widest">No history found</p>
          </div>
        ) : (
          <>
            {projects.length > 0 && unassignedConvs.length > 0 && (
              <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Conversations</p>
            )}
            {unassignedConvs.map(conv => <ConvRow key={conv.id} conv={conv} />)}
          </>
        )}

        {hasMore && onLoadMore && (
          <button
            onClick={onLoadMore}
            className="w-full py-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:text-emerald-400 transition-colors"
          >
            Load More
          </button>
        )}
      </div>

      {/* Right-click context menu — renders inline (no side submenu) to avoid sidebar edge overflow */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1 w-52"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {/* Rename */}
          <button
            className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2"
            onClick={() => {
              const conv = conversations.find(c => c.id === contextMenu.convId);
              if (conv) startRename(conv, { stopPropagation: () => {} } as any);
              setContextMenu(null);
            }}
          >
            <Pencil className="w-3 h-3 text-zinc-500" />
            Rename
          </button>

          {/* Move to Project — expands inline */}
          <button
            className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center justify-between gap-2"
            onClick={() => setContextMenu(prev => prev ? { ...prev, showProjectSub: !prev.showProjectSub } : null)}
          >
            <span className="flex items-center gap-2">
              <FolderPlus className="w-3 h-3 text-zinc-500" />
              Move to Project
            </span>
            {contextMenu.showProjectSub
              ? <ChevronDown className="w-3 h-3 text-zinc-600" />
              : <ChevronRight className="w-3 h-3 text-zinc-600" />
            }
          </button>

          {/* Inline project list */}
          {contextMenu.showProjectSub && (
            <div className="mx-2 mb-1 bg-zinc-800/60 rounded-lg overflow-hidden border border-zinc-700/50">
              {projects.map(proj => (
                <button
                  key={proj.id}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700/60 transition-colors truncate block"
                  onClick={() => { onAssignConversationToProject(contextMenu.convId, proj.id); setContextMenu(null); }}
                >
                  {proj.name}
                </button>
              ))}
              {conversations.find(c => c.id === contextMenu.convId)?.projectId && (
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-amber-400 hover:bg-zinc-700/60 transition-colors border-t border-zinc-700/50"
                  onClick={() => { onAssignConversationToProject(contextMenu.convId, null); setContextMenu(null); }}
                >
                  Remove from project
                </button>
              )}
              {projects.length === 0 && (
                <p className="px-3 py-1.5 text-[10px] text-zinc-600">No projects yet</p>
              )}
            </div>
          )}

          <div className="border-t border-zinc-800 my-1" />

          {/* Delete */}
          <button
            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-zinc-800 transition-colors flex items-center gap-2"
            onClick={(e) => { onDeleteConversation(contextMenu.convId, e); setContextMenu(null); }}
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
        </div>
      )}

      {/* New Project modal — styled to match dark theme */}
      {showNewProjectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowNewProjectModal(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-72 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-zinc-200 mb-3">New Project</p>
            <input
              ref={newProjectInputRef}
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewProject(); if (e.key === 'Escape') setShowNewProjectModal(false); }}
              placeholder="Project name..."
              className="w-full bg-zinc-800 border border-zinc-700 focus:border-emerald-500/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors font-mono"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={submitNewProject}
                disabled={!newProjectName.trim()}
                className="flex-1 py-2 text-xs font-bold bg-emerald-500 text-black rounded-lg hover:bg-emerald-400 disabled:opacity-30 disabled:hover:bg-emerald-500 transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setShowNewProjectModal(false)}
                className="flex-1 py-2 text-xs font-bold bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-lg hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
