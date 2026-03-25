import { useState, useRef, useCallback } from 'react';
import type { Message, Conversation } from '../types';

const PAGE_SIZE = 50;

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

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
  };
}
