import GlobalHeader from "@/components/GlobalHeader";
import NrsClient from "./NrsClient";

export default async function NrsAssessmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <NrsClient token={token} />
    </div>
  );
}
