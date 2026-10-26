/**
 * Builds the POST body for a fuel fill from the form's raw string fields.
 *
 * Extracted from FuelFillForm so the one decision in it can be tested: a blank
 * gauge field means the gauge was NOT READ, and must be omitted rather than
 * sent as a number.
 *
 * `parseFloat('')` is NaN, and JSON.stringify turns NaN into null — so the old
 * code transmitted something null-shaped by accident, while the input's
 * `required` attribute meant nobody could ever do it. Accident plus prohibition
 * is not a contract, and the server now has a real one: absent means the gauge
 * was not read, and liters_before_fill is left unknown with it.
 *
 * A reading of 0 is a VALUE — a tank genuinely near empty must be recordable —
 * so blankness is tested for explicitly rather than by falsiness.
 */

export interface FillFormFields {
  date: string;
  gaugeBefore: string;
  litersAdded: string;
  pricePerLiter: string;
  notes: string;
}

export interface FillPayload {
  date: string;
  liters_added: number;
  price_per_liter: number;
  gauge_percent_before?: number;
  notes?: string;
}

export function buildFillPayload(fields: FillFormFields): FillPayload {
  const payload: FillPayload = {
    date: fields.date,
    liters_added: parseFloat(fields.litersAdded),
    price_per_liter: parseFloat(fields.pricePerLiter),
  };

  const gauge = fields.gaugeBefore.trim();

  if (gauge !== '') {
    payload.gauge_percent_before = parseFloat(gauge);
  }

  const notes = fields.notes.trim();

  if (notes !== '') {
    payload.notes = notes;
  }

  return payload;
}
