import { Suspense } from "react";
import CoverClient from "./CoverClient";

export default async function CoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CoverClient id={id} />
    </Suspense>
  );
}
