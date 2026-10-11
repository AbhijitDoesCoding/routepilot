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
      const parsed = marked.parse(content || '') as string;
      if (typeof window !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
        return DOMPurify.sanitize(parsed);
      }
      return parsed;
    } catch (err) {
      console.error('Failed to parse markdown:', err);
      return content;
    }
  }, [content]);

  return (
    <div
      className={`markdown-content overflow-x-auto text-sm leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
