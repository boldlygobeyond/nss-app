import { Suspense } from "react";
import SurveyClient from "./SurveyClient";
import GlobalHeader from "@/components/GlobalHeader";

export default function SurveyPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-secondary border-t-primary rounded-full animate-spin" />
          </div>
        }
      >
        <SurveyClient />
      </Suspense>
    </div>
  );
}
