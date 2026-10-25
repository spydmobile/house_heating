/**
 * Import verification.
 *
 * Extracted from importLegacyData.ts on 2026-10-25, after the original check
 * passed on a real partial import. It compared a TABLE TOTAL to the sqlite row
 * count: 78 imported legacy rows plus 31 pre-existing synced rows equals 109,
 * and sqlite held 109. Both numbers were true and the comparison answered a
 * different question than the one it was built for.
 *
 * The rule this encodes: verify the rows you TRIED to write against the rows
 * actually present under those same keys. A table total cannot distinguish
 * "my row landed" from "somebody else's row was already there".
 */

/** What one table's import attempted, and what is actually present under those keys. */
export interface TableVerification {
  table: string;
  /** The natural key of every row the import tried to write. */
  attempted: string[];
  /** The subset of those keys found present afterwards. */
  present: string[];
}

export interface Shortfall {
  table: string;
  attempted: number;
  present: number;
  /** The keys that were attempted and are not present. */
  missing: string[];
}

/**
 * Returns one Shortfall per table that is missing any attempted row.
 * An empty array means every attempted row is present — the only state in
 * which an import may commit.
 */
export function findShortfalls(verifications: TableVerification[]): Shortfall[] {
  const shortfalls: Shortfall[] = [];

  for (const { table, attempted, present } of verifications) {
    const found = new Set(present);
    const missing = attempted.filter((key) => !found.has(key));

    if (missing.length > 0) {
      shortfalls.push({
        table,
        attempted: attempted.length,
        present: attempted.length - missing.length,
        missing,
      });
    }
  }

  return shortfalls;
}

/** A one-line, readable account of a shortfall, for the error that rolls back. */
export function describeShortfall(shortfall: Shortfall): string {
  const sample = shortfall.missing.slice(0, 5).join(', ');
  const more =
    shortfall.missing.length > 5 ? ` and ${shortfall.missing.length - 5} more` : '';

  return (
    `${shortfall.table}: ${shortfall.present} of ${shortfall.attempted} attempted rows present, ` +
    `missing ${shortfall.missing.length} (${sample}${more})`
  );
}
