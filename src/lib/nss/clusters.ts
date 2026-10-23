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

// Fixed display order for the favorability chart — alphabetical by label.
// Charts must render clusters in this same order for every user so they're
// directly comparable to each other and over time.
export const CHART_ORDER: ClusterKey[] = [
  "Agency",
  "Belonging",
  "Stability",
  "Ecosystem",
  "Connections",
  "Purpose",
  "Recognition",
];

export const CLUSTER_COLORS: Record<ClusterKey, string> = {
  Agency: "#6366f1",
  Belonging: "#8b5cf6",
  Stability: "#06b6d4",
  Ecosystem: "#10b981",
  Connections: "#f59e0b",
  Purpose: "#ef4444",
  Recognition: "#ec4899",
};

// One-sentence plain-language description of each cluster, shared by the
// report cover (PDF) and the on-screen report page's reference table — a
// single source so the two never drift apart.
export const CLUSTER_DESCRIPTIONS: Record<ClusterKey, string> = {
  Agency: "Freedom to make decisions, develop your abilities, and pursue growth",
  Belonging: "Feeling accepted, understood, and free to be yourself",
  Stability: "Safety, security, predictability, and a sense of stability",
  Ecosystem: "Emotional expression, empathy, trust, and support",
  Connections: "Relationships that bring energy, connection, and meaningful exchange",
  Purpose: "Living in alignment with your values and contributing to something meaningful",
  Recognition: "Feeling appreciated, respected, fairly treated, and valued for your contributions",
};
