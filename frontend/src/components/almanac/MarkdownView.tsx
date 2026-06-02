"use client";

/**
 * Almanac-styled markdown renderer.
 *
 * Wraps react-markdown with component overrides so headings render in
 * Plex Sans/SC, code blocks in Plex Mono on paper-3, links in clay
 * with ink-hover, and blockquotes get a clay left border. Used in the
 * artifact detail modal's view mode; reusable anywhere we need
 * rendered markdown inside an Almanac surface.
 *
 * Safe by default: react-markdown does not execute scripts or
 * `dangerouslySetInnerHTML` raw HTML. GFM plugin enables tables,
 * strikethrough, autolinks, task lists.
 */

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  source: string;
  className?: string;
};

export function MarkdownView({ source, className }: Props) {
  return (
    <div className={`almanac-md ${className ?? ""}`} style={{ color: "var(--ink)" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <H level={1} {...p} />,
          h2: (p) => <H level={2} {...p} />,
          h3: (p) => <H level={3} {...p} />,
          h4: (p) => <H level={4} {...p} />,
          h5: (p) => <H level={5} {...p} />,
          h6: (p) => <H level={6} {...p} />,
          p: (p) => (
            <p
              {...p}
              className="my-3 text-[14px] leading-[1.65] text-ink first:mt-0 last:mb-0"
            />
          ),
          a: ({ href, children, ...rest }) => (
            <a
              {...rest}
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noreferrer" : undefined}
              className="text-clay-ink underline decoration-rule underline-offset-2 transition hover:decoration-clay-ink"
            >
              {children}
            </a>
          ),
          ul: (p) => (
            <ul
              {...p}
              className="my-3 list-disc space-y-1 pl-5 text-[14px] leading-[1.6] text-ink marker:text-ink-3"
            />
          ),
          ol: (p) => (
            <ol
              {...p}
              className="my-3 list-decimal space-y-1 pl-5 text-[14px] leading-[1.6] text-ink marker:text-ink-3"
            />
          ),
          li: (p) => <li {...p} className="pl-1" />,
          blockquote: (p) => (
            <blockquote
              {...p}
              className="my-4 border-l-2 border-clay bg-paper-2/60 px-4 py-2 text-[14px] italic text-ink-2 [&_p]:my-1"
            />
          ),
          hr: () => <hr className="my-6 border-0 border-t border-rule" />,
          code: ({ className, children, ...rest }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              // Fenced block — let <pre> wrap us; just style the inner code
              return (
                <code
                  {...(rest as ComponentPropsWithoutRef<"code">)}
                  className="block whitespace-pre font-mono text-[12.5px] leading-[1.5] text-ink"
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                {...(rest as ComponentPropsWithoutRef<"code">)}
                className="rounded-[2px] bg-paper-3 px-1 py-[1px] font-mono text-[12.5px] text-ink"
              >
                {children}
              </code>
            );
          },
          pre: (p) => (
            <pre
              {...p}
              className="my-3 overflow-x-auto border border-rule bg-paper-3 p-3"
            />
          ),
          table: (p) => (
            <div className="my-3 overflow-x-auto">
              <table
                {...p}
                className="w-full border-collapse border border-rule text-[13px]"
              />
            </div>
          ),
          thead: (p) => <thead {...p} className="bg-paper-2 text-ink" />,
          th: (p) => (
            <th
              {...p}
              className="border border-rule px-3 py-1.5 text-left font-medium"
            />
          ),
          td: (p) => <td {...p} className="border border-rule px-3 py-1.5 align-top text-ink-2" />,
          strong: (p) => <strong {...p} className="font-semibold text-ink" />,
          em: (p) => <em {...p} className="italic" />,
          img: (p) => (
            <img
              {...p}
              alt={p.alt ?? ""}
              className="my-3 max-w-full border border-rule"
            />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function H({
  level,
  children,
  ...rest
}: { level: 1 | 2 | 3 | 4 | 5 | 6 } & ComponentPropsWithoutRef<"h1">) {
  // Step the size down by header level; all use Plex SC for CN-led runs.
  const sizes: Record<number, string> = {
    1: "text-[22px] mt-6 mb-3",
    2: "text-[18px] mt-5 mb-2",
    3: "text-[15px] mt-4 mb-2",
    4: "text-[14px] mt-3 mb-1 uppercase tracking-wider text-ink-2",
    5: "text-[13px] mt-3 mb-1 uppercase tracking-wider text-ink-3",
    6: "text-[12px] mt-3 mb-1 uppercase tracking-wider text-ink-3",
  };
  const Tag = `h${level}` as "h1";
  return (
    <Tag
      {...rest}
      className={`font-sc font-medium text-ink first:mt-0 ${sizes[level]}`}
    >
      {children}
    </Tag>
  );
}
