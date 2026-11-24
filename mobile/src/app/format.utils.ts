const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function formatMoney(value: number): string {
  return eur.format(value);
}

/** Whole euros, for big totals. */
export function formatMoney0(value: number): string {
  return eur0.format(value);
}

export function formatSignedMoney(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${eur.format(Math.abs(value))}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatSignedPercent(value: number, decimals = 2): string {
  const pct = (value * 100).toFixed(decimals);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${pct.replace('-', '')} %`.replace('.', ',');
}

/** Price with as many decimals as it needs (crypto can be 0.000005). */
export function formatPrice(value: number, currency = 'EUR'): string {
  const abs = Math.abs(value);
  const decimals = abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 1 ? 4 : abs < 10 ? 3 : 2;
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

export function formatQty(value: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: value < 1 ? 8 : 4 }).format(value);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-03" -> "mar 26" */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

/** "2026-03-14" -> "14 mar 2026" */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
}

export function signClass(value: number): string {
  return value > 0.000001 ? 'up' : value < -0.000001 ? 'down' : '';
}
