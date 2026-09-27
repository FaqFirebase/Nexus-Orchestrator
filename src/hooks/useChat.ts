import { useState, useRef, useCallback } from 'react';
import type { Message, Attachment, RoutingDecision, NexusConfig, McpErrorKind } from '../types';

interface UseChatDeps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  conversations: any[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  setConversations: React.Dispatch<React.SetStateAction<any[]>>;
  config: NexusConfig;
  localModels: any[];
  showThinkingEnabled: boolean;
}

const DEFAULT_CONVERSATION_TITLE = 'New Orchestration';
const PLACEHOLDER_TITLES = ['New Chat', 'New Conversation', DEFAULT_CONVERSATION_TITLE];
const TITLE_MAX_LENGTH = 40;

export function useChat(deps: UseChatDeps) {
  const {
    messages, setMessages, conversations,
    activeConversationId, setActiveConversationId, setConversations,
    config, localModels, showThinkingEnabled,
  } = deps;

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [routingStep, setRoutingStep] = useState<'idle' | 'analyzing' | 'routing' | 'searching' | 'generating'>('idle');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = [];
    const fileList = Array.from(files) as File[];

    for (const file of fileList) {
      const id = Math.random().toString(36).substring(7);

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        const content = await new Promise<string>((resolve) => {
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
        newAttachments.push({ id, name: file.name, type: file.type, size: file.size, content, preview: content });
      } else {
        const text = await file.text();
        newAttachments.push({ id, name: file.name, type: file.type, size: file.size, content: text });
      }
    }
    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const routeIntent = useCallback(async (prompt: string, hasAttachments: boolean): Promise<RoutingDecision> => {
    const res = await fetch(`${window.location.origin}/api/router`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        hasAttachments,
        availableModels: localModels.map(m => m.name),
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Router failed");
    }
    return await res.json();
  }, [localModels]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    let currentConvId = activeConversationId;
    const activeConv = conversations.find(c => c.id === activeConversationId);
    const hasPlaceholderTitle = activeConv && PLACEHOLDER_TITLES.includes(activeConv.title);
    let isNew = hasPlaceholderTitle || false;

    if (!currentConvId) {
      try {
        const res = await fetch(`${window.location.origin}/api/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: input.trim().slice(0, TITLE_MAX_LENGTH) || DEFAULT_CONVERSATION_TITLE,
            messages: []
          })
        });
        if (res.ok) {
          const newConv = await res.json();
          setConversations(prev => [newConv, ...prev]);
          setActiveConversationId(newConv.id);
          currentConvId = newConv.id;
        }
      } catch (err) {
        console.error("Failed to auto-create conversation", err);
        return;
      }
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      attachments: [...attachments],
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);

    // This send's own copy of the exchange. Saving from it (not from React state) keeps the
    // right conversation intact even if the user switches chats while the reply streams.
    const history = messages;
    let assistantState: Message | null = null;
    const updateAssistant = (patch: (m: Message) => Partial<Message>) => {
      if (!assistantState) return;
      assistantState = { ...assistantState, ...patch(assistantState) };
      const next = assistantState;
      setMessages(msgs => msgs.map(m => (m.id === next.id ? next : m)));
    };
    const persistConversation = (finalMessages: Message[]) => {
      if (!currentConvId) return;
      const convId = currentConvId;
      const updateData: { messages: Message[]; title?: string } = { messages: finalMessages };
      if (isNew) {
        updateData.title = userMsg.content.trim().slice(0, TITLE_MAX_LENGTH) || DEFAULT_CONVERSATION_TITLE;
      }
      fetch(`${window.location.origin}/api/conversations/${convId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      }).then(() => {
        setConversations(prev => prev.map(c => (c.id === convId ? { ...c, ...updateData } : c)));
      }).catch(err => console.error('Failed to save conversation', err));
    };
    setInput('');
    setAttachments([]);
    setIsLoading(true);
    setRoutingStep('analyzing');
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const imageAttachments = (userMsg.attachments || []).filter(a => a.type.startsWith('image/'));
      const docAttachments = (userMsg.attachments || []).filter(a => !a.type.startsWith('image/'));

      /** Extracts a plain model name from a CategoryModel or legacy string entry. */
      const modelName = (m: any): string => (typeof m === 'string' ? m : m?.name ?? '');
      const providerUrl = (m: any): string => (typeof m === 'string' ? '' : m?.providerUrl ?? '');

      /** Builds fallback model names and their corresponding provider URLs from a category pool,
       *  excluding the model already chosen as primary. */
      const buildFallbacks = (models: any[], primaryName: string) => {
        const rest = models.filter(m => modelName(m) !== primaryName);
        return {
          fallbackModels: rest.map(modelName),
          fallbackProviderUrls: rest.map(providerUrl),
        };
      };

      let decision: RoutingDecision;
      if (imageAttachments.length > 0 && docAttachments.length === 0) {
        const visionCfg = config.categories['VISION'];
        const primary = visionCfg?.models?.[0];
        const primaryName = modelName(primary);
        decision = {
          category: 'VISION',
          model: primaryName,
          providerUrl: providerUrl(primary),
          ...buildFallbacks(visionCfg?.models ?? [], primaryName),
          provider: visionCfg?.provider || 'local',
          reasoning: 'Image attachment detected',
          confidence: 1.0,
        };
      } else if (docAttachments.length > 0 && imageAttachments.length === 0) {
        const docCfg = config.categories['DOCUMENT'];
        const primary = docCfg?.models?.[0];
        const primaryName = modelName(primary);
        decision = {
          category: 'DOCUMENT',
          model: primaryName,
          providerUrl: providerUrl(primary),
          ...buildFallbacks(docCfg?.models ?? [], primaryName),
          provider: docCfg?.provider || 'local',
          reasoning: 'Document attachment detected',
          confidence: 1.0,
        };
      } else {
        decision = await routeIntent(input || "Analyze attached files", (userMsg.attachments?.length || 0) > 0);
        // Fill in providerUrl for the primary model from the category config
        const categoryModels = config.categories[decision.category]?.models ?? [];
        if (decision.provider !== 'cloud') {
          const matched = categoryModels.find((m: any) => modelName(m) === decision.model);
          if (matched) decision.providerUrl = providerUrl(matched);
        }
        const { fallbackModels, fallbackProviderUrls } = buildFallbacks(categoryModels, decision.model);
        decision.fallbackModels = fallbackModels;
        decision.fallbackProviderUrls = fallbackProviderUrls;
      }
      setRoutingStep('routing');

      let fullPrompt = input;
      if (userMsg.attachments && userMsg.attachments.length > 0) {
        const docContext = userMsg.attachments
          .filter(a => !a.type.startsWith('image/'))
          .map(a => `[File: ${a.name}]\n${a.content}`)
          .join('\n\n');

        if (docContext) {
          fullPrompt = `Context from documents:\n${docContext}\n\nUser Question: ${input}`;
        }
      }

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        decision,
        timestamp: new Date()
      };
      assistantState = assistantMsg;
      // Only show the placeholder if this chat is still on screen
      setMessages(prev => (prev.some(m => m.id === userMsg.id) ? [...prev, assistantMsg] : prev));
      setRoutingStep('generating');

      const response = await fetch(`${window.location.origin}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          messages: [...messages, { ...userMsg, content: fullPrompt }],
          decision,
          webSearchEnabled,
          showThinkingEnabled,
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Nexus Orchestrator failed to connect to provider.');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';

      if (reader) {
        let clientBuf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          clientBuf += decoder.decode(value, { stream: true });
          const lines = clientBuf.split('\n');
          clientBuf = lines.pop() ?? ''; // keep incomplete trailing fragment

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);

              if (json.searching) {
                setRoutingStep('searching');
                updateAssistant(() => ({ webSearchQuery: json.query }));
                continue;
              }

              if (json.fetching) {
                setRoutingStep('searching');
                updateAssistant(() => ({ webFetchUrl: json.url, webFetchHost: json.host }));
                continue;
              }

              if (json.sources) {
                updateAssistant(() => ({ webSearchSources: json.sources }));
                continue;
              }

              if (json.tool_called) {
                const tc = json.tool_called as { serverId: string; serverName: string; toolName: string; args?: unknown };
                setRoutingStep('searching');
                updateAssistant(m => ({
                  mcpToolCalls: [...(m.mcpToolCalls || []), { serverId: tc.serverId, serverName: tc.serverName, toolName: tc.toolName, args: tc.args }],
                }));
                continue;
              }

              if (json.tool_result) {
                const tr = json.tool_result as { serverId: string; isError: boolean; errorKind?: string; durationMs?: number };
                updateAssistant(m => {
                  const calls = m.mcpToolCalls || [];
                  const reversedIdx = [...calls].reverse().findIndex(c => c.serverId === tr.serverId && c.isError === undefined);
                  if (reversedIdx < 0) return {};
                  const realIdx = calls.length - 1 - reversedIdx;
                  const updated = [...calls];
                  updated[realIdx] = { ...updated[realIdx], isError: tr.isError, errorKind: tr.errorKind as McpErrorKind, durationMs: tr.durationMs };
                  return { mcpToolCalls: updated };
                });
                continue;
              }

              if (json.message?.content) {
                accumulatedContent += json.message.content;
                setRoutingStep('generating');
              }

              if (json.usage) {
                updateAssistant(() => ({ content: accumulatedContent, usage: json.usage }));
              } else if (json.message?.content) {
                updateAssistant(() => ({ content: accumulatedContent }));
              }
            } catch (e) {
              // Handle partial JSON or stream artifacts
            }
          }
        }
      }

      persistConversation([...history, userMsg, assistantState ?? assistantMsg]);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User stopped generation — keep the exchange, including any partial reply
        persistConversation(assistantState ? [...history, userMsg, assistantState] : [...history, userMsg]);
      } else {
        const isRouterError = error.message.includes('Router');
        const errorMsg: Message = {
          id: 'error-' + Date.now(),
          role: 'assistant',
          content: isRouterError
            ? `[Router Error]: ${error.message}`
            : `[Nexus Error]: ${error.message}. Please verify your local provider is active.`,
          timestamp: new Date()
        };
        setMessages(prev => (prev.some(m => m.id === userMsg.id) ? [...prev, errorMsg] : prev));
        persistConversation([...history, userMsg, ...(assistantState ? [assistantState] : []), errorMsg]);
      }
    } finally {
      setIsLoading(false);
      setRoutingStep('idle');
    }
  }, [input, attachments, isLoading, activeConversationId, messages, setMessages, setConversations, setActiveConversationId, routeIntent, conversations, config, showThinkingEnabled]);

  return {
    input,
    setInput,
    attachments,
    setAttachments,
    isLoading,
    routingStep,
    webSearchEnabled,
    setWebSearchEnabled,
    fileInputRef,
    handleFileSelect,
    removeAttachment,
    handleSend,
    handleStop,
  };
}
