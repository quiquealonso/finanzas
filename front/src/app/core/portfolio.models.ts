export type TypeCode = 'LIQUID' | 'STOCK' | 'ETF' | 'FUND' | 'CRYPTO' | 'REAL_ESTATE' | 'METAL' | 'LOANS';
export type Currency = 'EUR' | 'USD' | 'GBP';

export interface AssetRow {
  id: string;
  name: string;
  bankId: string;
  bankName: string;
  typeCode: TypeCode;
  typeName: string;
  isLiquidity: boolean;
  currency: Currency;
  symbol: string | null;
  provider: string | null;
  lastPriceSyncAt: string | null;
  quantity: number;
  priceLocal: number;
  priceEur: number;
  valueEur: number;
  costEur: number;
  pnlEur: number;
  pnlPct: number;
  realizedEur: number;
  dayChangePct: number;
  dayChangeEur: number;
  /** Percent by region code, e.g. { US: 60, EU: 40 }. */
  regions: Record<string, number>;
  regionsCustom: boolean;
  /** Loan platforms (Mintos): expected annual return in use, e.g. 8. */
  yieldRatePct?: number | null;
}

export interface Overview {
  asOf: string;
  /** Day of the latest stock market close the daily change refers to. */
  lastCloseDay: string | null;
  totalEur: number;
  costEur: number;
  /** Open positions only. */
  unrealizedEur: number;
  /** Already closed by sales. */
  realizedEur: number;
  /** unrealized + realized */
  pnlEur: number;
  pnlPct: number;
  dayChangeEur: number;
  dayChangePct: number;
  /** realized = cumulative result of sales up to that day. */
  /** result: running total of the daily gains (same rules as the calendar); a period gain is the difference of two points. */
  series: Array<{ date: string; value: number; cost: number; realized: number; result: number; opening?: number }>;
  allocation: Array<{ code: TypeCode; name: string; valueEur: number }>;
  assets: AssetRow[];
  banks: Array<{ id: string; name: string }>;
  types: Array<{ code: TypeCode; name: string; isLiquidity: boolean }>;
  lastSync: { finishedAt: string; assetsOk: number; assetsFailed: number; errors: string | null } | null;
}

export interface MonthlyPoint {
  date: string;
  price: number;
  currency: string;
  priceEur: number;
  value: number;
  cost: number;
  quantity: number;
  /** Running result of the asset (calendar rules): the gain between two columns is the difference. */
  result?: number;
}

export interface MonthlyData {
  months: string[];
  latest: string;
  /** Cumulative realized result (sales) at each column key ('YYYY-MM' or 'now'). */
  realized: Record<string, number>;
  assets: Array<{
    id: string;
    name: string;
    bankName: string;
    typeCode: TypeCode;
    typeName: string;
    isLiquidity: boolean;
    points: Record<string, MonthlyPoint>;
  }>;
}

export type MovementKind = 'buy' | 'sell' | 'deposit' | 'withdraw' | 'transfer' | 'adjust';

export interface Movement {
  id: string;
  groupId: string;
  date: string;
  type: 'BUY' | 'SELL';
  kind: string;
  assetId: string;
  assetName: string;
  bankName: string;
  isLiquidity: boolean;
  currency: Currency;
  quantity: number;
  price: number;
  fee: number;
  amountEur: number;
  realizedPnlEur: number | null;
  note: string | null;
  recurringId: string | null;
  period: string | null;
}

export interface PriceQuote {
  priceLocal: number;
  currency: string;
  fxToEur: number;
  priceEur: number;
  date: string;
  source: string;
}

export interface RecurringPlan {
  id: string;
  assetId: string;
  assetName: string;
  bankName: string;
  amountEur: number;
  dayOfMonth: number;
  fromCash: boolean;
  startMonth: string;
  active: boolean;
  note: string | null;
  totalInvestedEur: number;
  history: Array<{ period: string; date: string; quantity: number; price: number; amountEur: number; groupId: string }>;
}

export interface RecurringPending {
  recurringId: string;
  period: string;
  dueDate: string;
  assetId: string;
  assetName: string;
  bankName: string;
  amountEur: number;
  /** Plan note, e.g. "Saveback". */
  note: string | null;
  estPrice: number | null;
  estPriceDate: string | null;
  estQuantity: number | null;
}

export interface RecurringData {
  items: RecurringPlan[];
  pending: RecurringPending[];
}

export const TYPE_COLORS: Record<string, string> = {
  STOCK: 'var(--t-stock)',
  FUND: 'var(--t-fund)',
  ETF: 'var(--t-etf)',
  CRYPTO: 'var(--t-crypto)',
  LIQUID: 'var(--t-liquid)',
  REAL_ESTATE: 'var(--t-real)',
  LOANS: 'var(--t-loans)',
  METAL: 'var(--t-metal)'
};

export const REGIONS: Array<{ code: string; name: string; color: string }> = [
  { code: 'ES', name: 'España', color: '#dc2626' },
  { code: 'EU', name: 'Resto de Europa', color: '#2563eb' },
  { code: 'US', name: 'EE. UU.', color: '#7c3aed' },
  { code: 'CN', name: 'China', color: '#f59e0b' },
  { code: 'EM', name: 'Otros emergentes', color: '#ea580c' },
  { code: 'DEV', name: 'Otros desarrollados', color: '#0891b2' },
  { code: 'COMMODITY', name: 'Materias primas', color: '#a16207' },
  { code: 'CRYPTO', name: 'Cripto', color: '#d946ef' },
  { code: 'CASH', name: 'Liquidez', color: '#10b981' }
];

export interface RealizedSale {
  id: string;
  groupId: string;
  date: string;
  year: string;
  assetId: string;
  assetName: string;
  bankName: string;
  typeCode: TypeCode;
  typeName: string;
  kind: string;
  note: string | null;
  quantity: number;
  price: number;
  currency: Currency;
  proceedsEur: number;
  costEur: number;
  pnlEur: number;
  pnlPct: number;
  holdingDays: number;
  firstBuyDay: string;
  annualizedPct: number | null;
  positionClosed: boolean;
}

export interface RealizedAsset {
  assetId: string;
  assetName: string;
  bankName: string;
  typeCode: TypeCode;
  typeName: string;
  costEur: number;
  proceedsEur: number;
  pnlEur: number;
  pnlPct: number;
  firstBuyDay: string;
  lastSellDay: string;
  holdingDays: number;
  sales: number;
  annualizedPct: number | null;
  positionClosed: boolean;
}

export interface RealizedData {
  sales: RealizedSale[];
  byYear: Array<{ year: string; gains: number; losses: number; net: number; proceeds: number; count: number }>;
  byAsset: RealizedAsset[];
}

export interface RealEstateTicket {
  assetId: string;
  name: string;
  bankId: string;
  bankName: string;
  investedEur: number;
  ratePct: number;
  startDate: string | null;
  termMonths: number | null;
  endDate: string | null;
  daysToEnd: number | null;
  /** 0..1 of the term already elapsed. */
  progress: number | null;
  accruedEur: number | null;
  expectedInterestEur: number | null;
  valueEur: number;
  status: 'active' | 'matured' | 'collected' | 'incomplete';
  collectedDate: string | null;
  collectedEur: number | null;
  realizedEur: number | null;
  buyGroupId: string | null;
}

export interface IntradayData {
  /** Madrid calendar day of the points. */
  day: string | null;
  previousClose: { date: string; value: number; cost: number } | null;
  points: Array<{ ts: string; value: number; cost: number }>;
}

/** Hand-filled monthly closings sheet, separate from the tracked portfolio. */
export type ClosingCell = number | string;

export interface ClosingRow {
  id: string;
  name: string;
  position: number;
  /** "0" = opening value, "1".."12" = month closes. A string is a free-text note. */
  cells: Record<string, ClosingCell>;
  /** Money invested at each key (asset rows only). */
  costs: Record<string, number>;
  /** Value on 31 December of the year before (asset rows held then). */
  openingValue: number | null;
  /** Set on rows filled by the month close. */
  assetId: string | null;
  typeName: string | null;
}

export interface ClosingSection {
  id: string;
  name: string;
  position: number;
  /** Counts in the sheet's "Patrimonio total". */
  inTotal: boolean;
  /** 'cash' = Liquidez (by hand), 'bank' = assets of one bank (month close), 'manual' = free section. */
  kind: 'cash' | 'bank' | 'manual';
  rows: ClosingRow[];
}

export interface ClosingSheet {
  year: number;
  years: number[];
  sections: ClosingSection[];
}

export interface Goal {
  id: string;
  name: string;
  targetEur: number;
  targetDate: string;
  /** Monthly contribution to simulate; null = the active recurring plans. */
  monthlyEur: number | null;
  /** Portfolio value when the goal was created. */
  startValueEur: number;
  startDate: string;
  position: number;
}

export interface GoalsData {
  goals: Goal[];
  /** Yearly volatility of each asset's price over the last year. */
  risk: Array<{ assetId: string; days: number; volatility: number }>;
}

/** Target allocation row: assetId and name null = the type itself (pct of the portfolio), otherwise pct inside the type. */
export interface AllocationTarget {
  typeCode: string;
  assetId: string | null;
  name: string | null;
  pct: number;
}

export type NewsTier = 'important' | 'minor' | 'low';

export interface NewsItem {
  id: string;
  assetId: string | null;
  assetName: string | null;
  /** 'daily' = stocks, 'monthly' = actively managed funds. */
  scope: 'daily' | 'monthly';
  tier: NewsTier;
  title: string;
  summary: string | null;
  impact: string | null;
  sentiment: 'up' | 'down' | 'neutral' | null;
  source: string | null;
  url: string;
  publishedAt: string;
}

export interface NewsDigest {
  id: string;
  /** Monday of the week. */
  weekStart: string;
  headline: string;
  body: string;
}

export interface NewsData {
  items: NewsItem[];
  digests: NewsDigest[];
}

/** Magic Formula screen (Greenblatt): one weekly run with its best companies. */
export interface MagicPick {
  rank: number;
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCapUsd: number;
  priceUsd: number | null;
  ebitUsd: number;
  evUsd: number;
  earningsYield: number;
  roc: number;
  rankEy: number;
  rankRoc: number;
  annualOnly: boolean;
}

export interface MagicFormulaData {
  run: { id: string; runDate: string; minCapUsd: number; universe: number; period: string } | null;
  runs: Array<{ id: string; runDate: string }>;
  picks: MagicPick[];
  /** Symbols of the run before, to mark the new entries; null when there is no earlier run. */
  previous: string[] | null;
}

/** Perpetual future read from Hyperliquid. Its asset value = margin + unrealized PnL (never the notional). */
export interface PerpPosition {
  assetId: string;
  name: string;
  address: string;
  coin: string;
  side: 'long' | 'short' | 'closed';
  size: number;
  notionalUsd: number;
  entryPx: number | null;
  markPx: number | null;
  leverage: number | null;
  leverageType: string | null;
  liquidationPx: number | null;
  marginUsd: number;
  unrealizedPnlUsd: number;
  valueUsd: number;
  fundingSinceOpenUsd: number;
  syncedAt: string;
  /** Totals so far, negative = paid. */
  feesUsd: number;
  builderFeesUsd: number;
  fundingUsd: number;
}

export interface PerpsData {
  positions: PerpPosition[];
  accounts: Array<{ address: string; lastSyncAt: string | null; lastError: string | null }>;
}

/** On-chain wallets read by public address: differences waiting for the user and tokens not linked to an asset. */
export interface WalletDiff {
  chain: string;
  token: string;
  symbol: string | null;
  assetId: string;
  assetName: string;
  onChain: number;
  inApp: number;
  diff: number;
}

export interface WalletsData {
  accounts: Array<{ chain: string; address: string; lastSyncAt: string | null; lastError: string | null }>;
  pending: WalletDiff[];
  unmapped: Array<{ chain: string; token: string; symbol: string | null; name: string | null; amount: number; usdPrice: number | null; usdValue: number | null }>;
}

/** Daily gain/loss calendar: change of (value - cost + realized) per day. */
export interface CalendarDay {
  date: string;
  pnl: number;
  /** Gain over the value of the day before; null when there was nothing invested. */
  pct: number | null;
  value: number;
}

export interface CalendarDayDetail {
  date: string;
  assets: Array<{ assetId: string; name: string; bankName: string; typeCode: TypeCode; pnl: number; pct: number | null }>;
}

/** An index of the page Comparar: closes in euros, oldest first ([day, close]). */
export interface BenchmarkData {
  id: string;
  name: string;
  note: string;
  group: 'Acciones' | 'Otros';
  symbol: string | null;
  /** First day with data (some ETFs are younger than the portfolio). */
  first: string | null;
  closes: Array<[string, number]>;
}
