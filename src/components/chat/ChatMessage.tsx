import { Terminal, Cpu, FileText, Globe } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../../types';
import { CATEGORY_CONFIG } from '../../constants';
import RoutingAnalysis from '../RoutingAnalysis';

// Preprocess LaTeX so remark-math/KaTeX can render it
function preprocessLatex(content: string): string {
  let result = content;
  // Fix mismatched delimiters: $$...$ → $$...$$ and $...$$ → $$...$$
  result = result.replace(/\$\$([^$]+)\$(?!\$)/g, (_, inner) => `$$${inner}$$`);
  result = result.replace(/(?<!\$)\$([^$]+)\$\$/g, (_, inner) => `$$${inner}$$`);
  // Wrap standalone \command{...} not already inside $ delimiters
  result = result.replace(/(?<!\$)\\(boxed|frac|sqrt|sum|prod|int|lim|begin|end|left|right|mathbf|mathrm|textbf|text)(\{(?:[^{}]|\{[^{}]*\})*\})(?!\$)/g,
    (_, cmd, args) => `$\\${cmd}${args}$`);
  return result;
}

interface ChatMessageProps {
  msg: Message;
}

export default function ChatMessage({ msg }: ChatMessageProps) {
  return (
    <div className="flex items-start gap-4">
      <div className={`mt-1 w-6 h-6 rounded flex items-center justify-center border ${
        msg.role === 'user' ? 'bg-zinc-800 border-zinc-700' : 'bg-emerald-500/10 border-emerald-500/20'
      }`}>
        {msg.role === 'user' ? <Terminal className="w-3 h-3" /> : <Cpu className="w-3 h-3 text-emerald-500" />}
      </div>

      <div className="flex-1 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {msg.role === 'user' ? 'System Input' : 'Nexus Output'}
          </span>
          {msg.decision && (
            <div className="flex items-center gap-2">
              <span className="text-zinc-700">/</span>
              <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[9px] font-bold uppercase tracking-wider ${CATEGORY_CONFIG[msg.decision.category]?.color || 'text-zinc-500'}`}>
                {CATEGORY_CONFIG[msg.decision.category]?.icon}
                {msg.decision.category}
              </div>
              <span className="text-[9px] font-mono text-zinc-600">via {msg.decision.model}{msg.decision.routerModel ? ` • routed by ${msg.decision.routerModel}` : ''}</span>
            </div>
          )}
          {msg.webSearchQuery && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[9px] font-bold text-blue-400 uppercase tracking-wider">
              <Globe className="w-3 h-3" />
              Web Search: {msg.webSearchQuery}
            </div>
          )}
        </div>

        <div className="text-sm leading-relaxed text-zinc-200 markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                return !inline && match ? (
                  <div className="relative group/code my-4">
                    <div className="absolute -top-3 right-4 px-2 py-1 bg-zinc-800 rounded text-[10px] font-bold text-zinc-400 uppercase tracking-widest border border-zinc-700 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity">
                      {match[1]}
                    </div>
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      className="rounded-xl !bg-black/50 !p-6 border border-zinc-800/50 !m-0"
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  </div>
                ) : (
                  <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-400 font-mono text-xs border border-zinc-700" {...props}>
                    {children}
                  </code>
                );
              },
              p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-2">{children}</ol>,
              li: ({ children }) => <li className="text-zinc-300">{children}</li>,
              h1: ({ children }) => <h1 className="text-xl font-bold text-white mt-8 mb-4">{children}</h1>,
              h2: ({ children }) => <h2 className="text-lg font-bold text-white mt-6 mb-3">{children}</h2>,
              h3: ({ children }) => <h3 className="text-base font-bold text-white mt-4 mb-2">{children}</h3>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-emerald-500/30 pl-4 py-1 italic text-zinc-400 my-4 bg-emerald-500/5 rounded-r">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto my-6 rounded-xl border border-zinc-800">
                  <table className="w-full text-left border-collapse">{children}</table>
                </div>
              ),
              th: ({ children }) => <th className="p-3 bg-zinc-900 font-bold text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800">{children}</th>,
              td: ({ children }) => <td className="p-3 border-b border-zinc-800/50 text-xs text-zinc-300">{children}</td>,
            }}
          >
            {preprocessLatex(msg.content)}
          </ReactMarkdown>
        </div>

        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 py-2">
            {msg.attachments.map((file) => (
              <div key={file.id} className="flex items-center gap-2 px-2 py-1 bg-zinc-900/50 rounded border border-zinc-800">
                {file.type.startsWith('image/') ? (
                  <img src={file.preview} className="w-8 h-8 rounded object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <FileText className="w-3 h-3 text-cyan-400" />
                )}
                <div className="flex flex-col">
                  <span className="text-[9px] font-mono text-zinc-300 truncate max-w-[120px]">{file.name}</span>
                  <span className="text-[8px] font-mono text-zinc-600">{(file.size / 1024).toFixed(1)} KB</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {msg.decision && <RoutingAnalysis decision={msg.decision} usage={msg.usage} />}
      </div>
    </div>
  );
}
