// NRS reuses NSS's cluster taxonomy exactly — no second, parallel list of
// cluster keys/labels to keep in sync. NRS-specific content (per-cluster
// configured status, questions) lives in the nrs_clusters/nrs_questions
// tables, keyed by these same ClusterKey string values.
export { type ClusterKey, CLUSTERS, CLUSTER_LABELS } from "@/lib/nss/clusters";
