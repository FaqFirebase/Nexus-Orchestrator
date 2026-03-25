import { useState, useRef, useCallback } from 'react';
import type { Message, Conversation, Project } from '../types';

const PAGE_SIZE = 50;

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);

  // Ref so fetchConversations doesn't recreate every time activeConversationId changes
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/conversations?limit=${PAGE_SIZE}&offset=0`);
      if (res.ok) {
        const data = await res.json();
        const convs = data.conversations || data;
        setConversations(convs);
        if (data.total !== undefined) {
          setTotalCount(data.total);
          setHasMore(convs.length < data.total);
        } else {
          setHasMore(false);
        }
        if (convs.length > 0 && !activeConversationIdRef.current) {
          setActiveConversationId(convs[0].id);
          // Fetch full conversation with messages
          const convRes = await fetch(`${window.location.origin}/api/conversations/${convs[0].id}`);
          if (convRes.ok) {
            const fullConv = await convRes.json();
            setMessages(fullConv.messages || []);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch conversations", err);
    }
  }, []);

  const loadMoreConversations = useCallback(async () => {
    if (!hasMore) return;
    try {
      const offset = conversations.length;
      const res = await fetch(`${window.location.origin}/api/conversations?limit=${PAGE_SIZE}&offset=${offset}`);
      if (res.ok) {
        const data = await res.json();
        const newConvs = data.conversations || [];
        setConversations(prev => [...prev, ...newConvs]);
        if (data.total !== undefined) {
          setTotalCount(data.total);
          setHasMore(offset + newConvs.length < data.total);
        } else {
          setHasMore(false);
        }
      }
    } catch (err) {
      console.error("Failed to load more conversations", err);
    }
  }, [conversations.length, hasMore]);

  const createNewConversation = useCallback(async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: "New Chat", messages: [] })
      });
      if (res.ok) {
        const newConv = await res.json();
        setConversations(prev => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
        setMessages([]);
        setTotalCount(prev => prev + 1);
      }
    } catch (err) {
      console.error("Failed to create conversation", err);
    }
  }, []);

  const deleteConversation = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${window.location.origin}/api/conversations/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setConversations(prev => {
          const remaining = prev.filter(c => c.id !== id);
          if (activeConversationId === id) {
            if (remaining.length > 0) {
              setActiveConversationId(remaining[0].id);
              // Fetch messages for new active conversation
              fetch(`${window.location.origin}/api/conversations/${remaining[0].id}`)
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data) setMessages(data.messages || []); });
            } else {
              setActiveConversationId(null);
              setMessages([]);
            }
          }
          return remaining;
        });
        setTotalCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error("Failed to delete conversation", err);
    }
  }, [activeConversationId]);

  const selectConversation = useCallback(async (id: string) => {
    setActiveConversationId(id);
    // Check if we already have messages in the local list
    const conv = conversations.find(c => c.id === id);
    if (conv?.messages?.length) {
      setMessages(conv.messages);
      return;
    }
    // Lazy-load full conversation from server
    try {
      const res = await fetch(`${window.location.origin}/api/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Failed to fetch conversation", err);
    }
  }, [conversations]);

  const renameConversation = useCallback(async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`${window.location.origin}/api/conversations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed })
      });
      if (res.ok) {
        setConversations(prev => prev.map(c =>
          c.id === id ? { ...c, title: trimmed } : c
        ));
      }
    } catch (err) {
      console.error("Failed to rename conversation", err);
    }
  }, []);

  // --- Projects ---

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/projects`);
      if (res.ok) setProjects(await res.json());
    } catch (err) {
      console.error("Failed to fetch projects", err);
    }
  }, []);

  const createProject = useCallback(async (name: string) => {
    try {
      const res = await fetch(`${window.location.origin}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const proj = await res.json();
        setProjects(prev => [...prev, proj]);
      }
    } catch (err) {
      console.error("Failed to create project", err);
    }
  }, []);

  const renameProject = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`${window.location.origin}/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setProjects(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));
      }
    } catch (err) {
      console.error("Failed to rename project", err);
    }
  }, []);

  const toggleProjectCollapsed = useCallback(async (id: string) => {
    setProjects(prev => {
      const proj = prev.find(p => p.id === id);
      if (!proj) return prev;
      const collapsed = !proj.collapsed;
      fetch(`${window.location.origin}/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collapsed }),
      }).catch(console.error);
      return prev.map(p => p.id === id ? { ...p, collapsed } : p);
    });
  }, []);

  const deleteProject = useCallback(async (id: string, deleteChats: boolean) => {
    try {
      const res = await fetch(`${window.location.origin}/api/projects/${id}?deleteChats=${deleteChats}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== id));
        if (deleteChats) {
          setConversations(prev => prev.filter(c => c.projectId !== id));
          setTotalCount(prev => Math.max(0, prev - conversations.filter(c => c.projectId === id).length));
        } else {
          setConversations(prev => prev.map(c => c.projectId === id ? { ...c, projectId: null } : c));
        }
      }
    } catch (err) {
      console.error("Failed to delete project", err);
    }
  }, [conversations]);

  const assignConversationToProject = useCallback(async (convId: string, projectId: string | null) => {
    try {
      const res = await fetch(`${window.location.origin}/api/conversations/${convId}/project`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) {
        setConversations(prev => prev.map(c => c.id === convId ? { ...c, projectId } : c));
      }
    } catch (err) {
      console.error("Failed to assign conversation to project", err);
    }
  }, []);

  const updateActiveConversationMessages = useCallback(async (newMessages: Message[]) => {
    if (!activeConversationId) return;
    try {
      await fetch(`${window.location.origin}/api/conversations/${activeConversationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages })
      });
      setConversations(prev => prev.map(c =>
        c.id === activeConversationId ? { ...c, messages: newMessages } : c
      ));
    } catch (err) {
      console.error("Failed to update conversation messages", err);
    }
  }, [activeConversationId]);

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    messages,
    setMessages,
    fetchConversations,
    loadMoreConversations,
    hasMore,
    totalCount,
    createNewConversation,
    deleteConversation,
    selectConversation,
    renameConversation,
    updateActiveConversationMessages,
    // Projects
    projects,
    fetchProjects,
    createProject,
    renameProject,
    toggleProjectCollapsed,
    deleteProject,
    assignConversationToProject,
  };
}
