import { useState, useRef, useCallback } from 'react';
import type { Message, Attachment, RoutingDecision, NexusConfig } from '../types';

interface UseChatDeps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  conversations: any[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  setConversations: React.Dispatch<React.SetStateAction<any[]>>;
  config: NexusConfig;
  localModels: any[];
}

const PLACEHOLDER_TITLES = ['New Chat', 'New Conversation', 'New Orchestration'];

export function useChat(deps: UseChatDeps) {
  const {
    messages, setMessages, conversations,
    activeConversationId, setActiveConversationId, setConversations,
    config, localModels,
  } = deps;

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [routingStep, setRoutingStep] = useState<'idle' | 'analyzing' | 'routing' | 'generating'>('idle');
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
    const modelList = localModels.map(m => m.name).join(', ');

    const categoriesPrompt = Object.entries(config.categories).map(([cat, cfg]) => {
      return `- ${cat}: ${cfg.models.join(', ')} (${cfg.provider})`;
    }).join('\n');

    const systemPrompt = `Analyze this user prompt and decide which model category is best.
      Prompt: "${prompt}"
      Has Attachments: ${hasAttachments}

      Available Models on User's System: ${modelList || "llama3.1, codellama, llava, mistral"}

      Category Definitions (use these to decide):
      - CODING: Writing, debugging, reviewing, or explaining code. Any request involving programming languages, scripts, algorithms, or software development.
      - REASONING: Complex analysis, comparisons, multi-step logic, math, science explanations, strategic thinking, or anything requiring deep thought.
      - CREATIVE: Writing stories, poems, marketing copy, brainstorming, humor, or any open-ended creative task.
      - VISION: ONLY when the user has attached an image and wants it analyzed, described, or interpreted. Requires Has Attachments = true with an image.
      - DOCUMENT: ONLY when the user has attached a document (PDF, text file) and wants it summarized, analyzed, or queried. Requires Has Attachments = true.
      - FAST: Very simple questions, greetings, one-word answers, or trivial tasks that need minimal processing. Use when speed matters more than depth.
      - SECURITY: Security analysis, vulnerability assessment, threat modeling, CTF challenges, penetration testing, malware analysis, or cybersecurity topics.
      - GENERAL: Simple factual questions, casual conversation, or anything that doesn't clearly fit the above categories.

      Configured Categories and Models:
      ${categoriesPrompt}

      Rules:
      - Only select VISION or DOCUMENT if Has Attachments is true.
      - Prefer REASONING over GENERAL for questions that require explanation, comparison, or analysis.
      - Prefer CODING over GENERAL for anything code-related, even if the question is simple.
      - Prefer SECURITY over GENERAL for anything security/hacking/CTF related.
      - Use FAST for trivial one-liner responses (greetings, yes/no, simple lookups) when the FAST category has models assigned.
      - Only use categories that appear in the configured list above.

      Return ONLY a JSON object with the following structure:
      {
        "category": "ONE_OF_THE_CATEGORIES",
        "model": "specific_model_name",
        "provider": "local" | "cloud",
        "reasoning": "short explanation",
        "confidence": 0.0-1.0
      }`;

    const res = await fetch(`${window.location.origin}/api/router`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: systemPrompt })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Router failed");
    }
    return await res.json();
  }, [config, localModels]);

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
            title: input.trim().slice(0, 40) || "New Orchestration",
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
    setInput('');
    setAttachments([]);
    setIsLoading(true);
    setRoutingStep('analyzing');
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const imageAttachments = (userMsg.attachments || []).filter(a => a.type.startsWith('image/'));
      const docAttachments = (userMsg.attachments || []).filter(a => !a.type.startsWith('image/'));

      let decision: RoutingDecision;
      if (imageAttachments.length > 0 && docAttachments.length === 0) {
        const visionCfg = config.categories['VISION'];
        decision = {
          category: 'VISION',
          model: visionCfg?.models?.[0] || '',
          fallbackModels: visionCfg?.models?.slice(1) || [],
          provider: visionCfg?.provider || 'local',
          reasoning: 'Image attachment detected',
          confidence: 1.0,
        };
      } else if (docAttachments.length > 0 && imageAttachments.length === 0) {
        const docCfg = config.categories['DOCUMENT'];
        decision = {
          category: 'DOCUMENT',
          model: docCfg?.models?.[0] || '',
          fallbackModels: docCfg?.models?.slice(1) || [],
          provider: docCfg?.provider || 'local',
          reasoning: 'Document attachment detected',
          confidence: 1.0,
        };
      } else {
        decision = await routeIntent(input || "Analyze attached files", (userMsg.attachments?.length || 0) > 0);
        const categoryModels = config.categories[decision.category]?.models || [];
        decision.fallbackModels = categoryModels.filter(m => m !== decision.model);
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
      setMessages(prev => [...prev, assistantMsg]);
      setRoutingStep('generating');

      const response = await fetch(`${window.location.origin}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          messages: [...messages, { ...userMsg, content: fullPrompt }],
          decision
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
              if (json.message?.content) {
                accumulatedContent += json.message.content;
              }

              if (json.usage) {
                setMessages(msgs =>
                  msgs.map(m =>
                    m.id === assistantMsg.id ? { ...m, content: accumulatedContent, usage: json.usage } : m
                  )
                );
              } else if (json.message?.content) {
                setMessages(msgs =>
                  msgs.map(m =>
                    m.id === assistantMsg.id ? { ...m, content: accumulatedContent } : m
                  )
                );
              }
            } catch (e) {
              // Handle partial JSON or stream artifacts
            }
          }
        }
      }

      // Save the complete conversation
      setMessages(finalMessages => {
        if (currentConvId) {
          const updateData: any = { messages: finalMessages };
          if (isNew) {
            updateData.title = input.trim().slice(0, 40) || "New Orchestration";
          }

          fetch(`${window.location.origin}/api/conversations/${currentConvId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          }).then(() => {
            setConversations(prev => prev.map(c =>
              c.id === currentConvId ? { ...c, ...updateData } : c
            ));
          });
        }
        return finalMessages;
      });

    } catch (error: any) {
      if (error.name === 'AbortError') {
        // User stopped generation — no error message needed
      } else {
        const isRouterError = error.message.includes('Router');
        setMessages(prev => [...prev, {
          id: 'error-' + Date.now(),
          role: 'assistant',
          content: isRouterError
            ? `[Router Error]: ${error.message}`
            : `[Nexus Error]: ${error.message}. Please verify your local provider is active.`,
          timestamp: new Date()
        }]);
      }
    } finally {
      setIsLoading(false);
      setRoutingStep('idle');
    }
  }, [input, attachments, isLoading, activeConversationId, messages, setMessages, setConversations, setActiveConversationId, routeIntent, conversations, config]);

  return {
    input,
    setInput,
    attachments,
    setAttachments,
    isLoading,
    routingStep,
    fileInputRef,
    handleFileSelect,
    removeAttachment,
    handleSend,
    handleStop,
  };
}
