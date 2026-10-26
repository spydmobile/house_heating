/**
 * Argument parsing for the climate backfill CLI.
 *
 * Kept separate from the entrypoint so the rules can be tested without a
 * database. Everything here REFUSES rather than guesses: the backfill writes
 * weather history into the authoritative store, and a run that silently chose
 * its own range would write a different span than the operator intended and
 * then report success.
 */

export interface BackfillArgs {
  from: string;
  to: string;
  /** False means dry run — the default, as it is for the legacy import. */
  write: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readFlag(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);

  if (index === -1) {
    return null;
  }

  const value = argv[index + 1];

  // `--from --write` would otherwise read the next flag as a date.
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a date in YYYY-MM-DD form`);
  }

  return value;
}

function requireDate(argv: string[], flag: string): string {
  const value = readFlag(argv, flag);

  if (value === null) {
    throw new Error(
      `${flag} is required — the backfill has no default range, ` +
        'because writing a span the operator did not ask for is indistinguishable ' +
        'from success. Usage: npm run backfill -- --from 2025-01-01 --to 2025-03-31 [--write]',
    );
  }

  if (!ISO_DATE.test(value)) {
    throw new Error(`${flag} must be YYYY-MM-DD, received '${value}'`);
  }

  // Rejects 2025-02-30 and 2025-13-01, which match the shape but are not days.
  const parsed = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} is not a real date: '${value}'`);
  }

  return value;
}

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const from = requireDate(argv, '--from');
  const to = requireDate(argv, '--to');

  if (from > to) {
    throw new Error(`--from ${from} is after --to ${to}`);
  }

  return { from, to, write: argv.includes('--write') };
}
