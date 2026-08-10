// A "ripple" diagram — the #1 priority need sits solid at the center, like
// a stone dropped in water, with the effect fading outward through the
// next two needs (one color family, varying opacity only). Each ring
// carries its own cluster name on its bottom half, top to bottom in
// priority order, matching the description list beside it — connection is
// implied by matching order and the ring/text sitting side by side, no
// leader lines needed.

const CENTER = 180;
const VIEWBOX = 360;

// Radius of each ring's own edge, innermost (step 0) to outermost (step 2).
const RING_RADII = [50, 105, 150];
const RING_OPACITY = [1, 0.18, 0.08];

// Y position to anchor each ring's name label. Step 0 (center disc) is
// dead center; steps 1 and 2 sit in the BOTTOM half of their own band, so
// reading top to bottom across all three labels matches priority order.
const LABEL_Y = [CENTER, CENTER + (RING_RADII[0] + RING_RADII[1]) / 2, CENTER + (RING_RADII[1] + RING_RADII[2]) / 2];

// Splits a cluster label into two short lines so it fits inside its ring
// band instead of overflowing — e.g. "Belonging & Identity" -> "Belonging &" / "Identity".
function wrapLabel(label: string): [string, string] {
  const mid = Math.ceil(label.length / 2);
  const idx = label.lastIndexOf(" ", mid + 3);
  const splitAt = idx > 0 ? idx : label.indexOf(" ");
  return [label.slice(0, splitAt), label.slice(splitAt + 1)];
}

export default function NeedsRipple({ steps }: { steps: { cluster: string; body: string }[] }) {
  return (
    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-center sm:items-center">
      <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="w-72 h-72 sm:w-80 sm:h-80 shrink-0">
        {RING_RADII.map((r, i) => (
          <circle key={i} cx={CENTER} cy={CENTER} r={r} className="fill-primary" opacity={RING_OPACITY[i]} />
        ))}

        {steps.map((step, i) => {
          const [line1, line2] = wrapLabel(step.cluster);
          return (
            <text
              key={i}
              x={CENTER}
              y={LABEL_Y[i]}
              textAnchor="middle"
              className={`font-heading font-bold ${i === 0 ? "fill-primary-foreground" : "fill-primary"}`}
              fontSize={11}
            >
              <tspan x={CENTER} dy="-0.3em">
                {line1}
              </tspan>
              <tspan x={CENTER} dy="1.2em">
                {line2}
              </tspan>
            </text>
          );
        })}
      </svg>

      <div className="flex-1 flex flex-col gap-4">
        {steps.map((step, i) => (
          <div key={i} className="sm:max-w-xs">
            <p className="font-heading text-sm font-bold text-primary mb-0.5">{step.cluster}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
