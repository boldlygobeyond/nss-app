import type { ReactNode } from "react";
import { BENTO_CARDS, MISSION_CONTROL_CARDS } from "@/lib/nss/missionControlContent";

// PDF-only closing page — same "there's more beyond this one survey" copy
// as the interstitial page's MissionControlPitch, but styled to match the
// rest of the report (and the PDF cover page) instead of the interstitial's
// bordered marketing cards: headings match the cover's centered headline
// style, the "why this matters" items are a plain bulleted list, and the
// Mission Control items reuse the same green-tinted card style as "Key
// Insights for Your Manager" earlier in the report.
export default function ReportClosingPage({ cta }: { cta: ReactNode }) {
  return (
    <>
      <h1 className="font-heading text-xl font-bold text-foreground mb-3 text-center">
        Your personal needs report is just the beginning.
      </h1>
      <p className="text-muted-foreground leading-relaxed mb-4">
        By mapping your entire team&apos;s needs you get a deep understanding of how everyone&apos;s needs are
        interconnected so you can take shortcuts that unlock your team&apos;s true potential.
      </p>
      <p className="font-heading font-semibold text-foreground text-sm mb-2">Get ready to unlock:</p>
      <ul className="list-disc pl-5 space-y-2 text-foreground text-sm leading-relaxed">
        {BENTO_CARDS.map((card) => (
          <li key={card.title}>
            <strong className="font-semibold">{card.title}:</strong> {card.body}
          </li>
        ))}
      </ul>

      <h2 className="font-heading text-xl font-bold text-foreground mt-12 mb-3 text-center">
        But the Needs Signal Survey is just one small piece of our Mission Control System.
      </h2>
      <div className="grid sm:grid-cols-2 gap-2">
        {MISSION_CONTROL_CARDS.map((card) => (
          <div key={card.title} className="bg-primary/5 border border-primary/10 rounded-xl p-3 print:break-inside-avoid">
            <p className="text-foreground font-semibold mb-1">{card.title}</p>
            <p className="text-muted-foreground text-sm leading-snug">{card.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 p-4 rounded-lg bg-secondary/50 border border-border/50 text-center print:break-inside-avoid">
        <p className="text-foreground leading-relaxed mb-4">
          Ready to see what&apos;s possible for your crew? Look over your personal insights and schedule a call with
          our co-founders today to get the personalized flight plan for your team.
        </p>
        {cta}
      </div>
    </>
  );
}
