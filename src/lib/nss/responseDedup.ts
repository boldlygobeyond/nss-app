/**
 * A single question can end up with more than one stored row for the same
 * submission (Back navigation across a slow write, a reload mid-answer, a
 * cross-device resume — see NSS_Back_Navigation_And_Duplicate_Fix.md). Every place that
 * turns raw nss_responses rows into Bradley-Terry input, a pairwise
 * matchup matrix, or an audit trail routes through this one function
 * first, so "which row counts" is answered exactly once and consistently
 * everywhere — individual scoring, team scoring, bootstrap stability, the
 * admin Insights page, and reports.
 *
 * The most recent row (by answered_at) is kept, matching "the final stored
 * answer reflects the respondent's most recent intentional choice" — this
 * applies equally to a genuine correction (Back, choose differently) and
 * to an accidental duplicate with the same choice repeated (keeping the
 * later of two identical rows is a no-op either way).
 */
export function latestResponsePerQuestion<T extends { question_id: number; answered_at: string }>(
  rows: T[],
): T[] {
  const latestByQuestion = new Map<number, T>();
  for (const row of rows) {
    const existing = latestByQuestion.get(row.question_id);
    if (!existing || row.answered_at >= existing.answered_at) {
      latestByQuestion.set(row.question_id, row);
    }
  }
  return [...latestByQuestion.values()].sort((a, b) => a.answered_at.localeCompare(b.answered_at));
}
