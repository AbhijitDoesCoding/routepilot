import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Configure marked with GFM support and line breaks
marked.setOptions({
  gfm: true,
  breaks: true,
});

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const html = useMemo(() => {
    try {
      let parsed = marked.parse(content || '') as string;
      if (typeof window !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
        parsed = DOMPurify.sanitize(parsed);
      }
      return parsed.replace(
        /<table(\s|>)/g,
        '<div class="table-container scroll-slim overflow-x-auto my-2.5 rounded-lg border border-ink-600/80"><table$1'
      ).replace(/<\/table>/g, '</table></div>');
    } catch (err) {
      console.error('Failed to parse markdown:', err);
      return content;
    }
  }, [content]);

  return (
    <div
      className={`markdown-content min-w-0 text-sm leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
