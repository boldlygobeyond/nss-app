import { Suspense } from "react";
import CombinedClient from "./CombinedClient";

export default async function CombinedPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CombinedClient id={id} />
    </Suspense>
  );
}
