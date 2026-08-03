// The seven psychological-need clusters the NSS survey measures.
// Ported from Base44's src/lib/questionBank.js — these are display constants,
// not survey content, so they stay in code rather than the DB.

export type ClusterKey =
  | "Agency"
  | "Belonging"
  | "Stability"
  | "Ecosystem"
  | "Connections"
  | "Purpose"
  | "Recognition";

export const CLUSTERS: ClusterKey[] = [
  "Agency",
  "Belonging",
  "Stability",
  "Ecosystem",
  "Connections",
  "Purpose",
  "Recognition",
];

export const CLUSTER_LABELS: Record<ClusterKey, string> = {
  Agency: "Agency & Growth",
  Belonging: "Belonging & Identity",
  Stability: "Core Stability",
  Ecosystem: "Emotional Ecosystem",
  Connections: "Energizing Connections",
  Purpose: "Purpose & Alignment",
  Recognition: "Recognition & Value",
};

export const CLUSTER_COLORS: Record<ClusterKey, string> = {
  Agency: "#6366f1",
  Belonging: "#8b5cf6",
  Stability: "#06b6d4",
  Ecosystem: "#10b981",
  Connections: "#f59e0b",
  Purpose: "#ef4444",
  Recognition: "#ec4899",
};
