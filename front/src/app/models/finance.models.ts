export type AssetType = 'liquido' | 'fondo' | 'accion' | 'etf' | 'cripto' | 'inmobiliario';
export type BettingTransactionType = 'DEPOSIT' | 'WITHDRAWAL';

export interface Bank {
  id: string;
  name: string;
}

export interface Asset {
  id: string;
  bankId: string;
  name: string;
  type: AssetType;
  currency: 'EUR' | 'USD';
  marketSymbol: string | null;
  marketProvider: string | null;
  lastPriceSyncAt: string | null;
  quantity: number;
  marketPrice: number;
  investedCost: number;
  totalBoughtQty: number;
  totalBoughtCost: number;
  totalSoldQty: number;
  totalSoldCost: number;
  totalSoldProceeds: number;
}

export interface AssetMetrics {
  assetId: string;
  bankId: string;
  bankName: string;
  name: string;
  type: AssetType;
  quantity: number;
  marketPrice: number;
  positionValue: number;
  positionCost: number;
  avgBuyOpen: number;
  avgBuyHistorical: number;
  avgSellHistorical: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  profitability: number;
}

export interface BankSummary {
  bankId: string;
  bankName: string;
  positionValue: number;
  positionCost: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  profitability: number;
}

export interface PortfolioSummary {
  positionValue: number;
  positionCost: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  profitability: number;
}

export interface MonthlySummary {
  month: string;
  operations: number;
  soldAmount: number;
  boughtAmount: number;
  fees: number;
  realizedPnL: number;
}

export interface TransferDraft {
  date: string;
  sourceAssetId: string;
  targetAssetId: string;
  soldQuantity: number;
  sellPrice: number;
  sellFee: number;
  buyPrice: number;
  buyFee: number;
  note: string;
}

export interface StandaloneOperationDraft {
  date: string;
  assetId: string;
  type: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee: number;
  note: string;
  fxToEur?: number;
}

export interface TransferRecord {
  id: string;
  kind: 'transfer' | 'operation';
  date: string;
  sourceAssetId: string;
  sourceAssetName: string;
  sourceBankId: string;
  sourceBankName: string;
  targetAssetId: string;
  targetAssetName: string;
  targetBankId: string;
  targetBankName: string;
  soldQuantity: number;
  sellPrice: number;
  sellFee: number;
  buyPrice: number;
  buyFee: number;
  boughtQuantity: number;
  netProceeds: number;
  soldCostBasis: number;
  realizedPnL: number;
  operationType?: 'buy' | 'sell';
  fxToEur?: number;
  note: string;
}

export interface DashboardData {
  banks: Bank[];
  assets: Asset[];
  portfolioSummary: PortfolioSummary;
  bankSummaries: BankSummary[];
  visibleAssetMetrics: AssetMetrics[];
  visibleMonthlySummary: MonthlySummary[];
  filteredTransfers: TransferRecord[];
}

export type AppPage =
  | 'dashboard'
  | 'bancos'
  | 'activos'
  | 'precios'
  | 'transacciones'
  | 'evolucion'
  | 'graficos'
  | 'apuestas';

export interface EvolutionPoint {
  month: string;
  bankId: string;
  bankName: string;
  positionValueEur: number;
  positionCostEur: number;
  realizedPnlEur: number;
  unrealizedPnlEur: number;
  totalPnlEur: number;
  profitability: number;
}

export interface EvolutionComparisons {
  sinceInception: number;
  vsPreviousMonth: number | null;
  vsPreviousWeek: number | null;
  currentValueEur: number;
}

export interface EvolutionPayload {
  items: EvolutionPoint[];
  monthlyItems: EvolutionPoint[];
  weeklyItems: EvolutionPoint[];
  comparisons: EvolutionComparisons;
}

export interface PriceSyncResult {
  month: string;
  updated: number;
  skipped: number;
  failed: Array<{ assetId: string; assetName: string; reason: string }>;
}

export interface BettingHouseSummary {
  id: string;
  name: string;
  deposits: number;
  withdrawals: number;
  netInHouse: number;
}

export interface BettingTransactionRecord {
  id: string;
  bettingHouseId: string;
  bettingHouseName: string;
  type: BettingTransactionType;
  amount: number;
  date: string;
  note: string;
}

export interface BettingDashboardData {
  year: number;
  houses: BettingHouseSummary[];
  transactions: BettingTransactionRecord[];
  totals: {
    deposits: number;
    withdrawals: number;
    net: number;
  };
}
