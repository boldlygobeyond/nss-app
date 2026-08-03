"use client";

import type { ReactNode } from "react";
import { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (isValidElement(node)) return nodeToText((node.props as { children?: ReactNode }).children);
  return "";
}

const CALLOUT_LABELS = ["Reflection", "Key signal"];

const INTRO_TEXT: Record<"employee" | "manager", string> = {
  employee:
    "Take a look at the report below to understand how your needs might show up in the workplace. Needs change over time and show up differently in different settings, so use this as a starting off point for understanding your priorities and tendencies.",
  manager:
    "Share the report below with your manager and have a conversation about how your needs translate into how you show up in the workplace. Share what resonates for you and what seems off. Most importantly, chat through what you need from the team to show up as your best each and every day.",
};

export default function ReportView({
  reportText,
  type,
  variant = "card",
}: {
  reportText: string | null;
  type: "employee" | "manager";
  variant?: "card" | "plain";
}) {
  if (!reportText) {
    return (
      <div className="bg-card rounded-2xl border border-border/50 p-8 text-center">
        <p className="text-muted-foreground">This report hasn&apos;t been generated yet.</p>
      </div>
    );
  }

  const wrapperClass =
    variant === "card" ? "bg-card rounded-2xl border border-border/50 p-6 md:p-8" : "";

  return (
    <div className={wrapperClass}>
      <div className="[&>*:first-child]:mt-0">
        <div className="p-4 rounded-lg bg-secondary/50 border border-border/50 text-sm text-foreground italic leading-relaxed print:break-inside-avoid">
          {INTRO_TEXT[type]}
        </div>

        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="font-heading text-3xl font-bold mb-6 text-foreground tracking-tight">{children}</h1>
            ),
            h2: ({ children }) => (
              <div className="mt-10 mb-4 print:break-after-avoid">
                <h2 className="font-heading text-xl font-bold text-foreground tracking-tight mb-2">{children}</h2>
                <div className="h-[3px] w-14 rounded-full bg-gradient-to-r from-primary to-accent" />
              </div>
            ),
            h3: ({ children }) => {
              const text = nodeToText(children);
              const numbered = text.match(/^(\d+)\.\s*(.+)$/);
              if (numbered) {
                return (
                  <div className="flex items-center gap-3 mt-8 mb-3 print:break-after-avoid">
                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                      {numbered[1]}
                    </span>
                    <h3 className="font-heading text-lg font-bold text-foreground">{numbered[2]}</h3>
                  </div>
                );
              }
              return (
                <h3 className="font-heading text-lg font-bold mb-2 mt-6 text-foreground print:break-after-avoid">
                  {children}
                </h3>
              );
            },
            p: ({ children }) => {
              const text = nodeToText(children).trim();
              for (const label of CALLOUT_LABELS) {
                const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, "is"));
                if (match) {
                  return (
                    <div className="my-4 pl-4 pr-4 py-3 border-l-4 border-accent bg-accent/5 rounded-r-lg print:break-inside-avoid">
                      <p className="text-xs font-bold uppercase tracking-wider text-accent mb-1">{label}</p>
                      <p className="text-foreground leading-relaxed">{match[1]}</p>
                    </div>
                  );
                }
              }
              return <p className="text-muted-foreground leading-relaxed mb-3">{children}</p>;
            },
            ul: ({ children }) => (
              <ul className="list-disc ml-5 space-y-1 text-muted-foreground mb-3">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal ml-5 space-y-1 text-muted-foreground mb-3">{children}</ol>
            ),
            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
            strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
            hr: () => <hr className="my-8 border-border" />,
            table: ({ children }) => (
              <div className="overflow-x-auto my-4 rounded-lg border border-border/50">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-primary/5">{children}</thead>,
            tbody: ({ children }) => <tbody>{children}</tbody>,
            tr: ({ children }) => <tr className="border-b border-border/50 last:border-0">{children}</tr>,
            th: ({ children }) => (
              <th className="text-left p-3 font-semibold text-primary whitespace-nowrap">{children}</th>
            ),
            td: ({ children }) => <td className="p-3 text-muted-foreground align-top">{children}</td>,
          }}
        >
          {reportText}
        </ReactMarkdown>

        <div className="mt-10 p-4 rounded-lg bg-secondary/50 border border-border/50 print:break-inside-avoid">
          <p className="font-heading text-base font-semibold text-foreground mb-3 text-center">
            Ready to decode your system and unlock what&apos;s possible?
          </p>
          <p className="text-sm text-foreground italic mb-2">
            Understanding individual needs is a great first step, but real transformation happens
            when everyone on the team can see how their needs are interconnected.
          </p>
          <p className="text-sm text-foreground italic">
            Head to{" "}
            <a
              href="https://www.boldlygobeyond.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium hover:underline"
            >
              www.boldlygobeyond.com
            </a>{" "}
            today to find out how you can map your entire team and reveal shortcuts to take to drive
            collective impact.
          </p>
        </div>
      </div>
    </div>
  );
}
