import type { ReactNode } from "react";
import { Lightbulb } from "lucide-react";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import type { ClusterScore } from "@/lib/nss/surveyEngine";
import { RIPPLE_INTRO_TEXT, type ReportData } from "@/lib/nss/reportTypes";
import NeedsChart from "./NeedsChart";
import NeedsRipple from "./NeedsRipple";

const INTRO_TEXT =
  "Take a look at your Needs Signal Report to understand how your needs might show up in the workplace. Share the report with your manager and have a conversation about what you need from the team to show up as your best each and every day.";

const FLIGHT_PLAN_EMAIL = "first.contact@boldlygobeyond.com";
const FLIGHT_PLAN_MAILTO = `mailto:${FLIGHT_PLAN_EMAIL}?subject=${encodeURIComponent("Let's Make a Personalized Flight Plan!")}`;

function possessivePronoun(pronouns: string | null | undefined): string {
  const p = pronouns || "";
  // Check "she" before "he" — "she/her" contains the substring "he", so
  // checking "he" first misclassified every she/her respondent as he/him.
  if (p.includes("she")) return "Her";
  if (p.includes("he")) return "His";
  return "Their";
}

const CLUSTER_LABEL_LIST = Object.values(CLUSTER_LABELS).sort((a, b) => b.length - a.length);

// Deterministically bolds cluster names wherever they appear in generated
// prose — safer than asking the model to emit inline markdown and parsing it.
function highlightClusters(text: string): ReactNode {
  const pattern = new RegExp(`(${CLUSTER_LABEL_LIST.map((l) => l.replace(/[&]/g, "\\&")).join("|")})`, "g");
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    CLUSTER_LABEL_LIST.includes(part) ? (
      <strong key={i} className="text-foreground font-semibold">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mt-10 mb-4 print:break-after-avoid">
      <h2 className="font-heading text-xl font-bold text-foreground tracking-tight mb-2">{children}</h2>
      <div className="h-[3px] w-14 rounded-full bg-accent" />
    </div>
  );
}

function InsightRow({ headline, body }: { headline: string; body: ReactNode }) {
  return (
    <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-6 print:break-inside-avoid">
      <p className="text-foreground font-semibold sm:w-56 shrink-0">{headline}</p>
      <p className="text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

export default function ReportView({
  reportData,
  scores,
  firstName,
  pronouns,
  variant = "card",
}: {
  reportData: ReportData | null;
  scores: Record<ClusterKey, ClusterScore> | null;
  firstName: string;
  pronouns?: string | null;
  variant?: "card" | "plain";
}) {
  // Also treats a report saved under an older schema version (missing
  // rippleChain) as "not generated" rather than crashing on it — the owner
  // re-generates automatically on their next visit to the page, but a
  // manager viewing a not-yet-revisited subordinate report should still
  // see a clean message instead of an error.
  if (!reportData || !reportData.rippleChain) {
    return (
      <div className="bg-card rounded-2xl border border-border/50 p-8 text-center">
        <p className="text-muted-foreground">This report hasn&apos;t been generated yet.</p>
      </div>
    );
  }

  const wrapperClass = variant === "card" ? "bg-card rounded-2xl border border-border/50 p-6 md:p-8" : "";

  return (
    <div className={wrapperClass}>
      <div className="p-4 rounded-lg bg-secondary/50 border border-border/50 text-sm text-foreground italic leading-relaxed print:break-inside-avoid">
        {INTRO_TEXT}
      </div>

      <div className="print:break-inside-avoid">
        <SectionHeading>Your Current Needs Snapshot</SectionHeading>
        <NeedsChart scores={scores} />
      </div>

      <div className="print:break-inside-avoid print:break-before-page">
        <SectionHeading>Prioritizing Your Needs</SectionHeading>
        <p className="text-muted-foreground leading-relaxed mb-4">
          When asked to choose between competing priorities, a few clear patterns emerged in what you tended to
          protect.
        </p>
      </div>
      <div className="my-4 pl-4 pr-4 py-3 border-l-4 border-accent bg-accent/5 rounded-r-lg print:break-inside-avoid">
        <p className="text-foreground leading-relaxed">
          <strong className="font-semibold">Key Pattern: </strong>
          {highlightClusters(reportData.keyPattern)}
        </p>
      </div>
      <div className="flex flex-col gap-3 mt-6">
        {reportData.choiceInsights.map((insight, i) => (
          <InsightRow key={i} headline={insight.headline} body={insight.body} />
        ))}
      </div>

      <div className="print:break-inside-avoid print:break-before-page">
        <SectionHeading>How Your Needs Are Interconnected</SectionHeading>
        <p className="text-muted-foreground leading-relaxed mb-6">{RIPPLE_INTRO_TEXT}</p>
      </div>
      <NeedsRipple steps={reportData.rippleChain} />

      <div className="print:break-inside-avoid print:break-before-page">
        <SectionHeading>Seeing the Signals</SectionHeading>
        <p className="text-muted-foreground leading-relaxed mb-4">
          A signal is an observable marker you can look out for to tell you if a key need of yours is going unmet.
          When you notice these behaviors popping up in your day-to-day work, use these reflection questions to get
          clear on what you need, and start a conversation with your manager or team.
        </p>
      </div>
      <div className="overflow-x-auto my-4 rounded-lg border border-border/50">
        <table className="w-full border-collapse text-sm table-fixed">
          <colgroup>
            <col className="w-[38%]" />
            <col className="w-[22%]" />
            <col className="w-[40%]" />
          </colgroup>
          <thead className="bg-primary/5">
            <tr>
              <th className="text-left p-3 font-semibold text-primary">When you see these signals...</th>
              <th className="text-left p-3 font-semibold text-primary">The underlying need is likely...</th>
              <th className="text-left p-3 font-semibold text-primary">
                Reflect on what you need by asking yourself...
              </th>
            </tr>
          </thead>
          <tbody>
            {reportData.signals.map((row, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="p-3 text-muted-foreground align-top">{row.signal}</td>
                <td className="p-3 text-foreground font-medium align-top">{row.need}</td>
                <td className="p-3 text-muted-foreground align-top">
                  <ul className="list-disc pl-4 space-y-1">
                    {row.questions.map((q, qi) => (
                      <li key={qi}>{q}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="print:break-inside-avoid print:break-before-page">
        <SectionHeading>Key Insights for Your Manager</SectionHeading>
        <p className="text-muted-foreground leading-relaxed mb-4">
          During your next 1:1 with your manager, walk through this report and chat through what you need to show
          up as your best. If the topics below resonate, use them as a starting off point for your conversation:
        </p>
        <p className="font-heading text-base font-bold text-foreground mb-3">
          Tips for Helping {firstName} Meet {possessivePronoun(pronouns)} Needs
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {reportData.managerInsights.map((insight, i) => (
          <div key={i} className="bg-primary/5 border border-primary/10 rounded-xl p-4 print:break-inside-avoid">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Lightbulb className="w-3.5 h-3.5 text-primary" />
              </div>
              <p className="text-foreground font-semibold">{insight.label.replace(/:\s*$/, "")}</p>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">{insight.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 p-4 rounded-lg bg-secondary/50 border border-border/50 print:break-inside-avoid">
        <p className="font-heading text-base font-semibold text-foreground mb-3 text-center">
          Ready to decode your system and unlock what&apos;s possible?
        </p>
        <p className="text-sm text-foreground italic mb-2">
          Understanding individual needs is a great first step, but real transformation happens when everyone on
          the team can see how their needs are interconnected.
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
          - or email{" "}
          <a href={FLIGHT_PLAN_MAILTO} className="text-primary font-medium hover:underline">
            {FLIGHT_PLAN_EMAIL}
          </a>{" "}
          - today to find out how you can map your entire team and reveal shortcuts to take to drive collective
          impact.
        </p>
      </div>
    </div>
  );
}
