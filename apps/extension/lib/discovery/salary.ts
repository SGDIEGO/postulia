/** Monedas reconocidas en los textos de salario de los portales. */
const CURRENCY_SYMBOLS: Array<[RegExp, string]> = [
  [/S\/\.?/i, "PEN"],
  [/\bUSD\b|\bUS\$/i, "USD"],
  [/\bEUR\b/i, "EUR"],
  [/\bGBP\b/i, "GBP"],
  [/\bCOP\b/i, "COP"],
  [/\bMXN\b/i, "MXN"],
  [/\bARS\b/i, "ARS"],
  [/\bCLP\b/i, "CLP"],
  [/\bPEN\b/i, "PEN"],
  [/\bUYU\b/i, "UYU"],
  [/\$/, "USD"],
  [/€/, "EUR"],
  [/£/, "GBP"],
];

/** Normaliza un texto de salario a importe y moneda. */
export function normalizeSalary(text: string | undefined): { salary?: string; currency?: string } {
  if (!text) return {};

  const currency = CURRENCY_SYMBOLS.find(([pattern]) => pattern.test(text))?.[1];
  const amount = text.match(/\d[\d.,\s]*/)?.[0];
  const salary =
    amount
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/[.,]+$/, "") || undefined;

  return { salary, currency };
}
