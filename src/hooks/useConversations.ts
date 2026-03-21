import { useState, useRef, useCallback } from 'react';
import type { Message, Conversation } from '../types';

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // Ref so fetchConversations doesn't recreate every time activeConversationId changes
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/conversations`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
        if (data.length > 0 && !activeConversationIdRef.current) {
          setActiveConversationId(data[0].id);
          setMessages(data[0].messages);
        }
      }
    } catch (err) {
      console.error("Failed to fetch conversations", err);
    }
  }, []);

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
              setMessages(remaining[0].messages);
            } else {
              setActiveConversationId(null);
              setMessages([]);
            }
          }
          return remaining;
        });
      }
    } catch (err) {
      console.error("Failed to delete conversation", err);
    }
  }, [activeConversationId]);

  const selectConversation = useCallback((id: string) => {
    setConversations(prev => {
      const conv = prev.find(c => c.id === id);
      if (conv) {
        setActiveConversationId(id);
        setMessages(conv.messages);
      }
      return prev;
    });
  }, []);

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
    createNewConversation,
    deleteConversation,
    selectConversation,
    renameConversation,
    updateActiveConversationMessages,
  };
}
