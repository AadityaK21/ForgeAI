"use client";
import { memo, isValidElement, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
export function CopyButton({
  text,
  label = "Copy message",
}: {
  text: string;
  label?: string;
}) {
  const [state, setState] = useState("");
  return (
    <button
      type="button"
      className="copy-button"
      aria-label={state || label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("Copied");
        } catch {
          setState("Could not copy. Select the text instead.");
        }
      }}
    >
      {state === "Copied" ? <Check size={15} /> : <Copy size={15} />}
      <span role="status">{state || label}</span>
    </button>
  );
}
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState("");
  const language = isValidElement<{ className?: string }>(children)
    ? children.props.className?.replace("language-", "")
    : "code";
  return (
    <div className="code-block">
      <div className="code-heading">
        <span>{language || "code"}</span>
        <button
          type="button"
          aria-label={copied || "Copy code"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                ref.current?.textContent || "",
              );
              setCopied("Copied");
            } catch {
              setCopied("Select code to copy");
            }
          }}
        >
          <Copy size={14} />
          <span role="status">{copied || "Copy code"}</span>
        </button>
      </div>
      <pre ref={ref} tabIndex={0}>
        {children}
      </pre>
    </div>
  );
}
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="markdown" dir="auto">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt, src }) =>
            typeof src === "string" ? (
              <a href={src} target="_blank" rel="noopener noreferrer">
                {alt || "Image link"}
              </a>
            ) : null,
          table: ({ children }) => (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Table"
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
