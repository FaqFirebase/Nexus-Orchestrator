import React, { useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, X, FileText, Activity, Network, Shield, Square, Globe, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Attachment } from '../../types';

interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  attachments: Attachment[];
  removeAttachment: (id: string) => void;
  isLoading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSend: () => void;
  handleStop: () => void;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  searxngConfigured: boolean;
  showThinkingEnabled: boolean;
  onToggleThinking: () => void;
}

export default function ChatInput({
  input, setInput, attachments, removeAttachment,
  isLoading, fileInputRef, handleFileSelect, handleSend, handleStop,
  webSearchEnabled, onToggleWebSearch, searxngConfigured,
  showThinkingEnabled, onToggleThinking,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
  }, []);

  useEffect(() => { adjustHeight(); }, [input, adjustHeight]);

  return (
    <div className="absolute bottom-0 left-0 right-0 pt-12 pb-6 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A] to-transparent">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/20 to-blue-500/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
        <div className="relative flex flex-col bg-zinc-900/80 border border-zinc-800 rounded-2xl backdrop-blur-xl focus-within:border-emerald-500/50 transition-all">

          <AnimatePresence>
            {attachments.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-2 p-3 border-b border-zinc-800"
              >
                {attachments.map((file) => (
                  <div key={file.id} className="relative group/file">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 rounded-lg border border-zinc-700">
                      {file.type.startsWith('image/') ? (
                        <img src={file.preview} className="w-4 h-4 rounded object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <FileText className="w-3 h-3 text-cyan-400" />
                      )}
                      <span className="text-[10px] font-mono text-zinc-300 max-w-[100px] truncate">{file.name}</span>
                      <button
                        onClick={() => removeAttachment(file.id)}
                        className="p-0.5 hover:bg-zinc-700 rounded transition-colors"
                      >
                        <X className="w-3 h-3 text-zinc-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-end gap-2 p-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              multiple
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-3 text-zinc-500 hover:text-emerald-500 transition-colors"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleThinking}
              title={showThinkingEnabled ? 'Thinking visible — click to hide' : 'Show model thinking'}
              className={`p-3 transition-colors ${showThinkingEnabled ? 'text-purple-400' : 'text-zinc-500 hover:text-purple-400'}`}
            >
              <Brain className="w-4 h-4" />
            </button>
            {searxngConfigured && (
              <button
                onClick={onToggleWebSearch}
                title={webSearchEnabled ? 'Web search on — click to disable' : 'Enable web search for this message'}
                className={`p-3 transition-colors ${webSearchEnabled ? 'text-blue-400' : 'text-zinc-500 hover:text-blue-400'}`}
              >
                <Globe className="w-4 h-4" />
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Enter prompt for orchestration..."
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-3 px-2 resize-none max-h-48 min-h-[44px] font-mono placeholder:text-zinc-700 transition-[height] duration-150 ease-out overflow-y-auto"
              rows={1}
            />
            {isLoading ? (
              <button
                onClick={handleStop}
                className="p-3 bg-red-500 text-white rounded-xl hover:bg-red-400 transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)]"
              >
                <Square className="w-4 h-4 fill-white" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && attachments.length === 0}
                className="p-3 bg-emerald-500 text-black rounded-xl hover:bg-emerald-400 disabled:opacity-30 disabled:hover:bg-emerald-500 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)]"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>

          {input.length > 0 && (
            <div className="px-4 pb-1.5 text-right">
              <span className="text-[10px] font-mono text-zinc-600">
                {input.length} chars{input.split('\n').length > 1 ? ` · ${input.split('\n').length} lines` : ''}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-6 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-600">
        <div className="flex items-center gap-1.5"><Activity className="w-3 h-3" /> Latency: 42ms</div>
        <div className="flex items-center gap-1.5"><Network className="w-3 h-3" /> Node: Localhost</div>
        <div className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> Secure: E2EE</div>
      </div>
    </div>
  );
}
