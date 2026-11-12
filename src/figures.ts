import type { StrategyEntryModelFigures } from "@tradejs/types";
import type { BreakoutSignal } from "./engine.js";

export function buildLondonFigures(
  signal: BreakoutSignal,
): StrategyEntryModelFigures {
  const { range, confirmationTime, close } = signal;
  return {
    zones: [
      {
        id: "session-range",
        kind: "london_range",
        start: { timestamp: range.start, value: range.high },
        end: { timestamp: range.end, value: range.low },
        color: "rgba(59,130,246,0.18)",
      },
    ],
    lines: [
      { id: "long-level", value: range.longLevel, color: "#16a34a" },
      { id: "short-level", value: range.shortLevel, color: "#dc2626" },
    ].map(({ id, value, color }) => ({
      id,
      kind: `london_${id}`,
      color,
      points: [
        { timestamp: range.end, value },
        { timestamp: confirmationTime, value },
      ],
    })),
    points: [
      {
        id: "confirmation",
        kind: "london_confirmation",
        points: [{ timestamp: confirmationTime, value: close }],
        radius: 6,
        color: "#7c3aed",
      },
    ],
  };
}
