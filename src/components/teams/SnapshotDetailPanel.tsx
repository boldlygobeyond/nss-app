// Shared detail panel for the Team Needs Landscape heatmap and the Needs
// Spectrum — sits to the right of the chart on desktop, below it on
// mobile. Always rendered at a fixed size (even with nothing selected) so
// opening/closing a selection never shifts the chart's layout.
export default function SnapshotDetailPanel({
  name,
  cluster,
  description,
}: {
  name: string | null;
  cluster: string | null;
  description: string | null;
}) {
  return (
    <div className="w-full lg:w-64 shrink-0 min-h-[5.5rem] rounded-lg bg-secondary/60 px-3 py-2.5 text-sm text-foreground">
      {name && cluster && description && (
        <div className="space-y-0.5">
          <p className="font-medium">{name}</p>
          <p>{cluster}</p>
          <p className="text-muted-foreground">{description}</p>
        </div>
      )}
    </div>
  );
}
