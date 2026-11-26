import { useState, Children } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check, Terminal, Sparkles, Download, ExternalLink, Loader2 } from 'lucide-react';

const MarkdownImage = ({ src, alt }: { src?: string; alt?: string }) => {
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  if (!src) return null;

  const resolvedSrc = src;

  const handleOpenPreview = () => {
    window.dispatchEvent(new CustomEvent('preview-image', { detail: { src: resolvedSrc } }));
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const sourceImage = new Image();
      sourceImage.crossOrigin = "anonymous";
      sourceImage.src = resolvedSrc;
      await new Promise<void>((resolve, reject) => {
        sourceImage.onload = () => resolve();
        sourceImage.onerror = () => reject(new Error('Unable to load image for download'));
      });

      const canvas = document.createElement('canvas');
      canvas.width = sourceImage.naturalWidth;
      canvas.height = sourceImage.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context || canvas.width === 0 || canvas.height === 0) {
        throw new Error('Unable to prepare image canvas');
      }

      context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

      const scale = Math.max(1, Math.min(canvas.width, canvas.height) / 512);
      const fontSize = Math.round(24 * scale);
      const horizontalPadding = 12 * scale;
      const verticalPadding = 8 * scale;
      const rightMargin = 24 * scale;
      const bottomMargin = 24 * scale;
      const radius = 8 * scale;
      context.font = `700 ${fontSize}px Arial, sans-serif`;
      const whiteText = 'IZI ';
      const orangeText = 'AI';
      const badgeWidth = context.measureText(whiteText).width
        + context.measureText(orangeText).width
        + horizontalPadding * 2;
      const badgeHeight = fontSize + verticalPadding * 2;
      const badgeX = canvas.width - badgeWidth - rightMargin;
      const badgeY = canvas.height - badgeHeight - bottomMargin;

      context.beginPath();
      context.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, radius);
      context.fillStyle = 'rgba(0, 0, 0, 0.6)';
      context.fill();
      context.textBaseline = 'middle';
      const textY = badgeY + badgeHeight / 2;
      const textX = badgeX + horizontalPadding;
      context.fillStyle = '#FFFFFF';
      context.fillText(whiteText, textX, textY);
      context.fillStyle = '#FF7A00';
      context.fillText(orangeText, textX + context.measureText(whiteText).width, textY);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('Unable to encode watermarked image'));
        }, 'image/png');
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `kevin-ai-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: '✨ Ifoto yabitswe!' }
      }));
    } catch (err) {
      console.error('Download error:', err);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: 'Ntibyashobotse kubika ifoto' }
      }));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="my-2.5 rounded-2xl overflow-hidden border border-gray-200 dark:border-[#2f3b43] bg-black/5 dark:bg-black/40 shadow-xs max-w-full group">
      <div className="relative overflow-hidden cursor-pointer" onClick={handleOpenPreview}>
        {error ? (
          <div className="w-full h-48 bg-gray-100 dark:bg-[#182229] flex flex-col items-center justify-center gap-2 p-4 text-center">
            <span className="text-2xl">🖼️</span>
            <p className="text-xs text-gray-500 dark:text-gray-400">Ntibyashobotse gufungura ifoto</p>
            <a 
              href={resolvedSrc} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-xs text-[#25D366] hover:underline flex items-center gap-1 font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              Fungura ahandi <ExternalLink size={12} />
            </a>
          </div>
        ) : (
          <>
            {isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-100/80 dark:bg-[#182229]/80">
                <Loader2 size={26} className="animate-spin text-[#FF7A00]" />
              </div>
            )}
            <img
              src={resolvedSrc}
              alt={alt || "Generated Image"}
              className="w-full max-h-[420px] object-cover transition-transform duration-200 group-hover:scale-[1.01] block bg-gray-100 dark:bg-[#182229]"
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setError(true);
              }}
              loading="eager"
              decoding="async"
            />
          </>
        )}
        
        {/* Compact Kevin AI Watermark Badge at bottom-right covering pollinations.ai completely with solid black */}
        <div className="absolute bottom-2.5 right-2.5 px-2.5 py-0.5 rounded-md bg-black text-white text-[10px] font-semibold flex items-center gap-1 shadow-md border border-white/20 select-none pointer-events-none z-20">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FF6600]"></span>
          <span className="text-white tracking-wide">IZI</span>
          <span className="text-[#FF7A00] font-black tracking-wider">AI</span>
        </div>

        {/* Action Buttons at Top-Right */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="px-3 py-1.5 rounded-full bg-black/80 hover:bg-black text-white shadow-md backdrop-blur-xs transition-all hover:scale-105 cursor-pointer flex items-center gap-1.5 text-xs font-medium border border-white/10"
            title="Download Image (with Izi AI Watermark)"
          >
            {isDownloading ? (
              <Loader2 size={13} className="animate-spin text-[#FF6600]" />
            ) : (
              <Download size={13} className="text-[#FF6600]" />
            )}
            <span className="text-[11px] font-semibold">Bika ifoto</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenPreview();
            }}
            className="p-2 rounded-full bg-black/80 hover:bg-black text-white shadow-md backdrop-blur-xs transition-all hover:scale-105 cursor-pointer flex items-center gap-1 text-xs border border-white/10"
            title="Reba Nini (Fullscreen)"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

const CodeBlock = ({ language, codeString, children, ...rest }: { language: string; codeString: string; children: any; [key: string]: any }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString.replace(/\n$/, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-gray-300 dark:border-[#2f3b43] bg-[#161c22] dark:bg-[#0d1217] shadow-sm">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#232b34] dark:bg-[#182229] border-b border-black/30 dark:border-[#222e35] text-xs">
        <div className="flex items-center gap-1.5 text-gray-300 dark:text-[#8696a0] font-mono text-[11px]">
          <Terminal size={13} className="text-[#25D366] dark:text-[#00a884]" />
          <span className="font-semibold uppercase tracking-wide">{language || 'code'}</span>
        </div>
        <button
          onClick={handleCopy}
          type="button"
          aria-label="Copy code snippet"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium text-gray-300 hover:text-white dark:text-gray-300 dark:hover:text-white bg-white/5 hover:bg-white/15 dark:bg-white/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check size={12} className="text-[#25D366] dark:text-[#00a884]" />
              <span className="text-[#25D366] dark:text-[#00a884]">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body */}
      <pre className="p-3 sm:p-3.5 text-[12px] sm:text-[13px] font-mono text-gray-100 dark:text-[#e9edef] leading-relaxed whitespace-pre-wrap break-words overflow-hidden">
        <code className={language ? `language-${language}` : ''} {...rest}>
          {children}
        </code>
      </pre>
    </div>
  );
};

const MarkdownRenderer = ({ content }: { content: string }) => {
  return (
    <div className="markdown-content text-[15px] sm:text-[16px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          code(props: any) {
            const { inline, className, children, ...rest } = props;
            const match = /language-(\w+)/.exec(className || '');
            const rawString = String(children || '');
            const isMultiline = rawString.includes('\n');

            // If it's a code block (explicit non-inline, has language tag, or contains multiline content)
            if (!inline && (match || isMultiline)) {
              return (
                <CodeBlock 
                  language={match ? match[1] : ''} 
                  codeString={rawString} 
                  {...rest}
                >
                  {children}
                </CodeBlock>
              );
            }

            // Inline Code Snippet with high contrast styling for light and dark themes
            return (
              <code
                className="inline-block px-1.5 py-0.5 mx-0.5 rounded font-mono text-[12.5px] sm:text-[13px] font-semibold bg-[#e9edef] dark:bg-[#111b21] text-[#111b21] dark:text-[#00a884] border border-gray-300 dark:border-[#2f3b43] shadow-xs align-baseline"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Passthrough pre wrapper to let custom CodeBlock handle the container
            return <>{children}</>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-[#075E54] dark:border-[#00a884] bg-black/5 dark:bg-[#182229]/80 pl-3.5 pr-3 py-2 my-2.5 rounded-r-xl text-gray-800 dark:text-gray-200 italic text-[14.5px] sm:text-[15.5px]">
                {children}
              </blockquote>
            );
          },
          h1({ children }) {
            return <h1 className="text-xl sm:text-2xl font-bold my-3 text-gray-900 dark:text-white leading-tight">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-lg sm:text-xl font-bold my-2.5 text-gray-900 dark:text-white leading-snug">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-base sm:text-lg font-semibold my-2 text-gray-900 dark:text-white">{children}</h3>;
          },
          h4({ children }) {
            return <h4 className="text-[15px] sm:text-base font-semibold my-1.5 text-gray-900 dark:text-white">{children}</h4>;
          },
          table({ children }) {
            return (
              <div className="my-2 rounded-lg border border-gray-300 dark:border-[#222e35] shadow-xs w-full overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-300 dark:divide-[#222e35] text-xs sm:text-[13px]">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-[#075E54] dark:bg-[#005c4b] text-white">{children}</thead>;
          },
          tbody({ children }) {
            return <tbody className="divide-y divide-gray-200 dark:divide-[#222e35] bg-white/40 dark:bg-[#182229]/40">{children}</tbody>;
          },
          tr({ children }) {
            return <tr className="even:bg-gray-50/80 dark:even:bg-[#1f2c34]/60 transition-colors">{children}</tr>;
          },
          th({ children }) {
            return (
              <th className="px-2 py-1.5 text-left text-[11px] sm:text-xs font-bold text-white uppercase tracking-wider">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-2 py-1.5 text-xs sm:text-[13px] text-gray-800 dark:text-gray-200 border-b border-gray-200/60 dark:border-[#222e35]/60 break-words">
                {children}
              </td>
            );
          },
          ul({ children }) {
            return <ul className="list-disc list-outside ml-5 my-2 space-y-1.5 text-[15px] sm:text-[16px]">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal list-outside ml-5 my-2 space-y-1.5 text-[15px] sm:text-[16px]">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#075E54] dark:text-[#00a884] font-medium hover:underline break-all"
              >
                {children}
              </a>
            );
          },
          p({ children }) {
            return <div className="mb-2.5 last:mb-0 leading-relaxed text-[15px] sm:text-[16px]">{children}</div>;
          },
          img({ src, alt }) {
            return <MarkdownImage src={src} alt={alt} />;
          },
          hr() {
            return <hr className="my-3 border-gray-300 dark:border-[#2f3b43]" />;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
