import React, { useRef, useEffect } from 'react';
import { Network } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Message, Attachment, ConnectionStatus } from '../../types';
import { CATEGORY_CONFIG } from '../../constants';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import RoutingStatus from './RoutingStatus';

interface ChatTabProps {
  messages: Message[];
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  routingStep: 'idle' | 'analyzing' | 'routing' | 'searching' | 'generating';
  input: string;
  setInput: (v: string) => void;
  attachments: Attachment[];
  removeAttachment: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSend: () => void;
  handleStop: () => void;
  setActiveTab: (tab: 'chat' | 'models' | 'system') => void;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  searxngConfigured: boolean;
}

export default function ChatTab({
  messages, connectionStatus, isLoading, routingStep,
  input, setInput, attachments, removeAttachment,
  fileInputRef, handleFileSelect, handleSend, handleStop, setActiveTab,
  webSearchEnabled, onToggleWebSearch, searxngConfigured,
}: ChatTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-12 pb-32 scroll-smooth"
      >
        {/* Local IP Warning Banner */}
        {connectionStatus.local &&
         (connectionStatus.local.includes('192.168.') || connectionStatus.local.includes('10.') || connectionStatus.local.includes('172.') || connectionStatus.local.includes('localhost')) &&
         (window.location.hostname.includes('run.app') || window.location.hostname.includes('google.com')) && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-2xl mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-4 items-start"
          >
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
              <Network className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-amber-500">Local Network Detected</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                You are trying to connect to a local IP (<code className="text-zinc-200">{connectionStatus.local}</code>).
                Cloud-hosted apps cannot reach your home network directly.
              </p>
              <button
                onClick={() => setActiveTab('models')}
                className="text-[10px] font-bold text-amber-500 uppercase tracking-wider hover:underline mt-2"
              >
                Configure Models →
              </button>
            </div>
          </motion.div>
        )}

        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-8 opacity-40">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                <div key={key} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 flex flex-col items-center gap-3">
                  <div className={config.color}>{config.icon}</div>
                  <span className="text-[9px] font-bold uppercase tracking-widest">{key}</span>
                </div>
              ))}
            </div>
            <p className="text-xs font-mono max-w-sm leading-relaxed">
              Intelligent intent-based routing to specialized local models. Enter a prompt to begin orchestration.
            </p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="group"
            >
              <ChatMessage msg={msg} />
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && <RoutingStatus routingStep={routingStep} />}
      </div>

      <ChatInput
        input={input}
        setInput={setInput}
        attachments={attachments}
        removeAttachment={removeAttachment}
        isLoading={isLoading}
        fileInputRef={fileInputRef}
        handleFileSelect={handleFileSelect}
        handleSend={handleSend}
        handleStop={handleStop}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={onToggleWebSearch}
        searxngConfigured={searxngConfigured}
      />
    </div>
  );
}
