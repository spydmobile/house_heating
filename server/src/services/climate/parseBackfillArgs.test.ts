import { describe, it, expect } from 'vitest';

import { parseBackfillArgs } from './parseBackfillArgs.js';

/**
 * The backfill writes weather history into the authoritative store, so its
 * arguments are refused rather than guessed. There is no default range: a
 * backfill that silently picks its own dates would write a different span than
 * the operator intended and report success.
 *
 * Dry run is the default, matching the legacy import — writing requires
 * --write, explicitly.
 */
describe('parseBackfillArgs', () => {
  it('refuses to run without an explicit range rather than choosing one', () => {
    expect(() => parseBackfillArgs(['--write'])).toThrow(/--from/);
  });

  it('requires --to as well as --from', () => {
    expect(() => parseBackfillArgs(['--from', '2025-01-01'])).toThrow(/--to/);
  });

  it('reads an explicit range and defaults to a dry run', () => {
    expect(parseBackfillArgs(['--from', '2025-01-01', '--to', '2025-03-31'])).toEqual({
      from: '2025-01-01',
      to: '2025-03-31',
      write: false,
    });
  });

  it('writes only when --write is passed', () => {
    const args = parseBackfillArgs(['--from', '2025-01-01', '--to', '2025-03-31', '--write']);

    expect(args.write).toBe(true);
  });

  it('rejects a date that is the right shape but not a real day', () => {
    // 2025-02-30 passes a regex and is not a date. Stored as a shifted day it
    // would silently backfill the wrong span.
    expect(() =>
      parseBackfillArgs(['--from', '2025-02-30', '--to', '2025-03-31']),
    ).toThrow(/not a real date/);
  });

  it('rejects a malformed date rather than coercing it', () => {
    expect(() =>
      parseBackfillArgs(['--from', '2025-1-1', '--to', '2025-03-31']),
    ).toThrow(/YYYY-MM-DD/);
  });

  it('does not read the following flag as a date', () => {
    expect(() => parseBackfillArgs(['--from', '--write', '--to', '2025-03-31'])).toThrow(
      /requires a date/,
    );
  });

  it('refuses a reversed range', () => {
    expect(() =>
      parseBackfillArgs(['--from', '2025-03-31', '--to', '2025-01-01']),
    ).toThrow(/is after/);
  });

  it('accepts a single-day range', () => {
    const args = parseBackfillArgs(['--from', '2025-01-03', '--to', '2025-01-03']);

    expect(args).toEqual({ from: '2025-01-03', to: '2025-01-03', write: false });
  });
});
