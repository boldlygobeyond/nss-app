/**
 * Audits a real respondent's path through the adaptive survey: for every
 * post-calibration question, which selection tier actually produced it
 * (staleness guard / validation re-test / default closest-gap / a relaxed
 * guard), cross-checked against what the
 * *current* delivery code on disk would pick given the same real history —
 * so you can tell a genuine behavior change from "this run used an older
 * version of the logic." It also replays the Bradley-Terry ranking and
 * bootstrap top-3 confidence after every single question, so you can see
 * exactly when (if ever) the ranking settled, and what stopping earlier
 * than 50 would have actually cost.
 *
 * Usage: npx tsx scripts/audit-survey-path.ts <submissionId>
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { CLUSTERS, CLUSTER_LABELS, type ClusterKey } from "../src/lib/nss/clusters";
import type { SurveyQuestion, NssQuestionRow } from "../src/lib/nss/questions";
import { questionFromRow } from "../src/lib/nss/questions";
import {
  selectNextBtQuestion,
  seedDeliveryStateFromHistory,
  applyAnswerOutcome,
  type DeliveryState,
  type SelectionTier,
} from "../src/lib/nss/adaptiveDelivery";
import { rankByBradleyTerry, top3Stability, type BtResponse } from "../src/lib/nss/bradleyTerry";

const submissionId = process.argv[2];
if (!submissionId) {
  console.error("Usage: npx tsx scripts/audit-survey-path.ts <submissionId>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: submission, error: subErr } = await supabase
    .from("nss_submissions")
    .select("respondent_name, user_email, status, questions_answered, question_sequence")
    .eq("id", submissionId)
    .single();
  if (subErr) throw subErr;

  // question_sequence only grows when a genuinely NEW question is added to
  // the sequence (calibration's fixed build, or a fresh adaptive pick) —
  // going back and re-answering an existing slot doesn't touch it. So
  // "the first 21 response ROWS" is the wrong way to find the calibration
  // boundary whenever a repeat happened during calibration; this is the
  // right way regardless of how many times anything was re-answered.
  const calibrationIds = new Set((submission.question_sequence as number[]).slice(0, 21));

  const { data: rawResponses, error: respErr } = await supabase
    .from("nss_responses")
    .select("question_id, chosen_clusters, rejected_clusters, is_sharpened, selection, answered_at")
    .eq("submission_id", submissionId)
    .order("answered_at", { ascending: true });
  if (respErr) throw respErr;

  // A repeated question_id means the respondent used the Back button to
  // return to an earlier question and answer again — NOT a UI glitch, even
  // when the second answer happens to match the first. An earlier version
  // of this script dropped same-selection repeats on that wrong assumption,
  // which silently deleted the exact event (a direct re-answer clearing a
  // pair's pendingValidation flag) needed to correctly replay delivery
  // state. Every recorded answer genuinely happened and affected the real
  // app's state at that moment — including the real Bradley-Terry fit,
  // which has no de-duplication of its own — so nothing here is dropped,
  // only flagged for visibility.
  const responses = rawResponses;
  const repeatCounts = new Map<number, number>();
  responses.forEach((r) => repeatCounts.set(r.question_id, (repeatCounts.get(r.question_id) ?? 0) + 1));
  for (const [qid, count] of repeatCounts) {
    if (count > 1) console.log(`Question ${qid} was answered ${count} times — respondent used Back to re-answer it.`);
  }

  const { data: questionRows, error: qErr } = await supabase.from("nss_questions").select("*");
  if (qErr) throw qErr;
  const allQuestions: SurveyQuestion[] = (questionRows as NssQuestionRow[]).map(questionFromRow);
  const qMap = Object.fromEntries(allQuestions.map((q) => [q.id, q]));
  // The real app's fetchQuestions() only ever serves ids 51+ when the BT
  // engine flag is on (src/lib/nss/questions.ts) — the replay's candidate
  // pool has to match that exactly, or it'll see "available" old-bank
  // questions (ids 1-50) the real respondent could never have been shown,
  // which inflates apparent supply and corrupts every tier/pool decision
  // downstream. Confirmed this was happening: an earlier version of this
  // script counted old-bank ids among a pair's "unused" questions.
  const questions = allQuestions.filter((q) => q.id >= 51);

  const distinctIds = new Set(responses.map((r) => r.question_id));
  console.log(`\nSubmission: ${submission.respondent_name} <${submission.user_email}> — ${submission.status}`);
  console.log(`${responses.length} answer events across ${distinctIds.size} distinct questions\n`);

  // Split by calibration-set membership, not by row position — a repeat
  // during calibration (Back, then re-answer) adds an extra ROW without
  // adding a new SLOT, so "first 21 rows" would silently swallow part of
  // the adaptive phase into the calibration bucket whenever that happens.
  const calibrationResponses = responses.filter((r) => calibrationIds.has(r.question_id));
  const adaptiveResponses = responses.filter((r) => !calibrationIds.has(r.question_id));

  // ── Calibration (Q1-21): fixed sequence, not selected by adaptiveDelivery ──
  // Walk the full 21-id sequence, not calibrationResponses — a question the
  // respondent skipped (via "it depends" -> still unsure -> Skip) is still a
  // real calibration slot that was PRESENTED and consumed from usedIds, it
  // just has no response row. Printing only the answered subset silently
  // dropped skipped slots from the Q1-21 list entirely.
  console.log("=== Q1-21: fixed calibration sequence (not tier-selected) ===");
  const responseByQid = new Map(responses.map((r) => [r.question_id, r]));
  const calibrationSequence = (submission.question_sequence as number[]).slice(0, 21);
  calibrationSequence.forEach((qid, i) => {
    const q = qMap[qid];
    const pair = q ? `${q.mappedClusters[0]}/${q.mappedClusters[1]}` : "?";
    const r = responseByQid.get(qid);
    const status = r ? (r.is_sharpened ? "  (it depends)" : "") : "  (SKIPPED — no answer recorded)";
    console.log(`  ${i + 1}. #${qid} [${pair}]${status}`);
  });

  // ── Adaptive phase: replay tier classification against CURRENT logic ──
  // State is threaded incrementally along Arthur's REAL path, exactly as
  // SurveyClient.tsx does: seed once at the Q22 transition, then for every
  // question after, advance lastSeenAt/recentPairKeys/recentQuestionClusters
  // from the question actually asked (not from whatever this replay would
  // have preferred) and run applyAnswerOutcome with the real is_sharpened
  // flag, before asking the real logic what it would pick next. Re-seeding
  // from scratch on every step (an earlier version of this script did that)
  // silently resets recentPairKeys to empty every time, since
  // seedDeliveryStateFromHistory never populates it — making the repeat-cap
  // check a no-op in the replay even though it's enforced for real.
  console.log("\n=== Q22-50: adaptive phase — tier that produced each pick ===");
  const tierCounts: Record<SelectionTier, number> = {
    staleness: 0,
    validation: 0,
    default: 0,
    "guard-relaxed": 0,
  };
  let mismatches = 0;

  function pairKeyOf(a: ClusterKey, b: ClusterKey): string {
    return [a, b].sort().join("|");
  }

  let state: DeliveryState = seedDeliveryStateFromHistory(
    calibrationResponses.map((r) => ({
      mappedClusters: qMap[r.question_id].mappedClusters,
      isSharpened: r.is_sharpened as boolean,
    })),
  );

  const calibrationCount = calibrationResponses.length;
  const fullSequence = submission.question_sequence as number[];
  for (let j = 0; j < adaptiveResponses.length; j++) {
    const i = calibrationCount + j; // position in the full chronological history
    const btResponsesSoFar: BtResponse[] = [...calibrationResponses, ...adaptiveResponses.slice(0, j)].map((r) => ({
      chosen_clusters: r.chosen_clusters,
      rejected_clusters: r.rejected_clusters,
    }));
    // usedIds has to be every question_id ever PRESENTED up to this point —
    // sourced from question_sequence, not from response rows. A skipped
    // question (calibration or adaptive) gets no response row but is still
    // permanently consumed from usedIds the moment it's shown (set at
    // calibration-build time for all 21 slots at once, or via newUsed.add()
    // the instant an adaptive pick is selected, in SurveyClient.tsx) — it
    // can never be re-offered even though it was never answered. Building
    // usedIds from response rows alone (an earlier version of this script
    // did that) makes a skipped question look "available" again, which lets
    // the replay pick it when the real app structurally could not — this
    // was confirmed against a real run where the only 3 questions for a
    // thin pair were a skip + two real answers, and the replay kept
    // "finding" the skipped one available long after the real app had
    // exhausted that pair's entire pool.
    const seqPos = fullSequence.indexOf(adaptiveResponses[j].question_id);
    const usedIds = new Set(fullSequence.slice(0, seqPos));

    const replay = selectNextBtQuestion(questions, btResponsesSoFar, usedIds, state, i);
    const actual = adaptiveResponses[j];
    const actualQ = qMap[actual.question_id];
    const actualPair = `${actualQ.mappedClusters[0]}/${actualQ.mappedClusters[1]}`;

    let tierLabel: string;
    if (!replay) {
      tierLabel = "(current logic found no candidates — unexpected)";
      mismatches++;
    } else {
      const replayPair = `${replay.question.mappedClusters[0]}/${replay.question.mappedClusters[1]}`;
      tierCounts[replay.tier]++;
      // Compare by cluster SET, not label order — "Ecosystem/Stability" and
      // "Stability/Ecosystem" are the same pair, just stored with cluster_a/
      // cluster_b flipped on that particular question row.
      const pairMatches = pairKeyOf(...replay.question.mappedClusters) === pairKeyOf(...actualQ.mappedClusters);
      if (!pairMatches) mismatches++;
      tierLabel = `${replay.tier}${pairMatches ? "" : `  [current logic would instead pick ${replayPair}]`}`;
    }

    console.log(
      `  Q${i + 1}. #${actual.question_id} [${actualPair}]${actual.is_sharpened ? "  (it depends)" : ""} — ${tierLabel}`,
    );

    // Advance state along Arthur's REAL path (not the replay's hypothetical
    // pick), so the next iteration's candidate pool reflects what actually
    // happened — exactly what SurveyClient.tsx's incremental threading does.
    const [a, b] = actualQ.mappedClusters;
    const actualNextState: DeliveryState = {
      recentPairKeys: [...state.recentPairKeys, pairKeyOf(a, b)].slice(-10),
      recentQuestionClusters: [...state.recentQuestionClusters, [a, b] as [ClusterKey, ClusterKey]].slice(-10),
      lastSeenAt: { ...state.lastSeenAt, [a]: i, [b]: i },
      pendingValidation: state.pendingValidation,
    };
    state = applyAnswerOutcome(actualNextState, actualQ.mappedClusters, actual.is_sharpened as boolean);
  }

  console.log("\nTier usage (adaptive phase):", tierCounts);
  if (mismatches > 0) {
    console.log(
      `\n${mismatches} question(s) don't match what today's delivery logic would pick given this respondent's exact real history. ` +
        `State above is threaded along the real path (not re-seeded each step), so this is a genuine discrepancy worth ` +
        `investigating — either a real divergence between this run's environment and the code on disk, or remaining ` +
        `non-determinism in the selection logic itself (e.g. shuffleArray breaking ties within a tier differently) — ` +
        `not something to assume away.`,
    );
  } else {
    console.log("\nEvery adaptive pick matches exactly what the current delivery logic would choose.");
  }

  // ── Confidence trajectory: ranking + bootstrap stability after every question ──
  console.log("\n=== Confidence trajectory: ranking and bootstrap stability after each question ===");
  console.log(`${"Q#".padStart(4)}  ${"Top-3".padEnd(45)}  Stability`);
  let lastTop3 = "";
  for (let n = 10; n <= responses.length; n++) {
    const soFar: BtResponse[] = responses.slice(0, n).map((r) => ({
      chosen_clusters: r.chosen_clusters,
      rejected_clusters: r.rejected_clusters,
    }));
    const ranked = rankByBradleyTerry(soFar);
    const top3 = ranked
      .slice(0, 3)
      .map((r) => CLUSTER_LABELS[r.cluster])
      .join(" > ");
    const { stability } = top3Stability(soFar, 300, 1);
    const changed = top3 !== lastTop3 ? " *" : "";
    if (n % 5 === 0 || n === responses.length || changed) {
      console.log(`${String(n).padStart(4)}  ${top3.padEnd(45)}  ${(stability * 100).toFixed(0)}%${changed}`);
    }
    lastTop3 = top3;
  }
  console.log("\n(* marks a question where the top-3 set actually changed from the previous question)");

  // ── Direct answer to "would stopping at 30 have been fine" ──
  const at30: BtResponse[] = responses.slice(0, Math.min(30, responses.length)).map((r) => ({
    chosen_clusters: r.chosen_clusters,
    rejected_clusters: r.rejected_clusters,
  }));
  const atFull: BtResponse[] = responses.map((r) => ({
    chosen_clusters: r.chosen_clusters,
    rejected_clusters: r.rejected_clusters,
  }));
  const top3At30 = rankByBradleyTerry(at30).slice(0, 3).map((r) => r.cluster);
  const top3Final = rankByBradleyTerry(atFull).slice(0, 3).map((r) => r.cluster);
  const { stability: stabilityAt30 } = top3Stability(at30, 400, 1);
  const { stability: stabilityFinal } = top3Stability(atFull, 400, 1);
  const sameSet = top3At30.length === top3Final.length && top3At30.every((c) => top3Final.includes(c));

  console.log("\n=== Would stopping at Q30 have changed anything? ===");
  console.log(`Top-3 at Q30:  ${top3At30.map((c) => CLUSTER_LABELS[c]).join(" > ")}  (stability ${(stabilityAt30 * 100).toFixed(0)}%)`);
  console.log(`Top-3 at Q50:  ${top3Final.map((c) => CLUSTER_LABELS[c]).join(" > ")}  (stability ${(stabilityFinal * 100).toFixed(0)}%)`);
  console.log(
    sameSet
      ? "Same top-3 set both times — the extra 20 questions firmed up confidence but didn't change the headline result."
      : "Different top-3 set — the extra 20 questions changed which clusters land in the top 3, not just how sure we are about them.",
  );
}

main();
