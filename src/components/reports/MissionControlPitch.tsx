import type { ReactNode } from "react";
import { BENTO_CARDS, MISSION_CONTROL_CARDS } from "@/lib/nss/missionControlContent";

// "There's more beyond this one survey" pitch for the post-survey
// interstitial page — its own branded marketing-card look, matching the
// landing page rather than the report's own visual language (see
// ReportClosingPage for the PDF's report-styled version of this same copy).
export default function MissionControlPitch({ headline, cta }: { headline: string; cta: ReactNode }) {
  return (
    <>
      <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-4 text-center leading-tight">
        {headline}
      </h1>
      <p className="text-muted-foreground text-lg mb-16 text-center leading-relaxed max-w-2xl mx-auto">
        By mapping your entire team&apos;s needs you get a deep understanding of how everyone&apos;s needs are
        interconnected so you can take shortcuts that unlock your team&apos;s true potential.
      </p>

      <div className="grid md:grid-cols-3 gap-4 mb-20">
        {BENTO_CARDS.map((card) => (
          <div key={card.title} className="bg-card border border-border/50 rounded-2xl p-6">
            <h3 className="font-heading text-lg font-semibold text-foreground mb-2">{card.title}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">{card.body}</p>
          </div>
        ))}
      </div>

      <div className="mb-20">
        <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-8 text-center leading-snug">
          But the Needs Signal Survey is just one small piece of our Mission Control System.
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {MISSION_CONTROL_CARDS.map((card) => (
            <div key={card.title} className="bg-card border border-border/50 rounded-2xl p-6">
              <h3 className="font-heading text-lg font-semibold text-foreground mb-2">{card.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border/50 rounded-2xl p-8 md:p-10 text-center shadow-sm">
        <p className="text-foreground text-lg leading-relaxed mb-8 max-w-xl mx-auto">
          Ready to see what&apos;s possible for your crew? Look over your personal insights and schedule a call with
          our co-founders today to get the personalized flight plan for your team.
        </p>
        {cta}
      </div>
    </>
  );
}
