/** Display helpers shared by the CLI tools. Nothing here rounds away a difference we rely on. */

export const usd = (value: number | null, digits = 2): string =>
  value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

/** Renders a fraction as a signed percentage. */
export const pct = (fraction: number | null, digits = 2): string =>
  fraction === null || !Number.isFinite(fraction)
    ? "—"
    : `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(digits)}%`;

/** Renders a fraction as an unsigned percentage, for shares and ratios. */
export const share = (fraction: number | null, digits = 1): string =>
  fraction === null || !Number.isFinite(fraction) ? "—" : `${(fraction * 100).toFixed(digits)}%`;

/** Full precision, for the index comparison where the last decimal is the whole point. */
export const exact = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? "—" : String(value);

export const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

export const padStart = (text: string, width: number): string =>
  text.length >= width ? text : " ".repeat(width - text.length) + text;
