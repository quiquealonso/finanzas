import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { base, prisma } from "./prisma";
import { registerAuthRoutes, requireUser } from "./auth";
import { registerPortfolioRoutes } from "./portfolio";
import { registerClosingRoutes } from "./closings";
import { registerGoalRoutes } from "./goals";
import { registerAllocationRoutes } from "./allocation";
import { registerNewsRoutes } from "./news";
import { registerMagicFormulaRoutes } from "./magic-formula";
import { registerHyperliquidRoutes } from "./hyperliquid";
import { registerWalletRoutes } from "./wallets";
import { registerCalendarRoutes } from "./calendar";
import { registerMailImportRoutes } from "./mail-import";
import { registerGmailCallback, registerGmailRoutes } from "./gmail";
import { registerPendingOrderRoutes } from "./bbva-orders";
import { registerSentimentRoutes } from "./sentiment";
import { registerValuationRoutes } from "./valuations";
import { registerRiskProfileRoutes } from "./risk-profile";
import { registerFundFinderRoutes } from "./fund-finder";
import { registerMailTemplateRoutes } from "./mail-templates";

dotenv.config();

const app = express();
const ALL_BANKS = "ALL";

app.use(cors());
app.use(bodyParser.json());

// Login and the list of users (no token needed). See src/auth.ts.
registerAuthRoutes(app);

// Google redirects here after the consent screen (no user header: the user travels in the state).
registerGmailCallback(app);

// Everything else needs a valid session token; the request runs as its user (row level security does the rest).
app.use(requireUser);

registerPortfolioRoutes(app);
registerMailImportRoutes(app);
registerGmailRoutes(app);
registerPendingOrderRoutes(app);
registerClosingRoutes(app);
registerGoalRoutes(app);
registerAllocationRoutes(app);
registerNewsRoutes(app);
registerMagicFormulaRoutes(app);
registerHyperliquidRoutes(app);
registerWalletRoutes(app);
registerCalendarRoutes(app);
registerSentimentRoutes(app);
registerValuationRoutes(app);
registerRiskProfileRoutes(app);
registerFundFinderRoutes(app);
registerMailTemplateRoutes(app);

type ApiAssetType = "liquido" | "fondo" | "accion" | "etf" | "cripto" | "inmobiliario";
type ApiMarketProvider = 'stooq' | 'alphavantage' | 'yahoo';
type DbAssetType = "LIQUID" | "FUND" | "STOCK" | "ETF" | "CRYPTO" | "REAL_ESTATE";
type DbCurrency = "EUR" | "USD" | "GBP";
type DbBettingTransactionType = "DEPOSIT" | "WITHDRAWAL";

type DbAssetRow = {
  id: string;
  bankId: string;
  name: string;
  type: DbAssetType;
  currency: DbCurrency;
  marketSymbol: string | null;
  marketProvider: string | null;
  lastPriceSyncAt: Date | null;
  quantity: unknown;
  investedCostLocal: unknown;
  investedCostEur: unknown;
  marketPriceLocal: unknown;
  marketPriceEur: unknown;
  totalBoughtQty: unknown;
  totalBoughtCostLocal: unknown;
  totalBoughtCostEur: unknown;
  totalSoldQty: unknown;
  totalSoldProceedsLocal: unknown;
  totalSoldProceedsEur: unknown;
  totalSoldCostBasisLocal: unknown;
  totalSoldCostBasisEur: unknown;
};

type DbTransferRow = {
  id: string;
  occurredAt: Date;
  sourceAssetId: string;
  targetAssetId: string;
  sourceFxToEur: unknown;
  soldQuantity: unknown;
  sellPriceLocal: unknown;
  sellFeeLocal: unknown;
  soldNetLocal: unknown;
  buyPriceLocal: unknown;
  buyFeeLocal: unknown;
  targetFxToEur: unknown;
  buyCostLocal: unknown;
  buyCostEur: unknown;
  boughtQuantity: unknown;
  soldNetEur: unknown;
  soldCostBasisEur: unknown;
  realizedPnlEur: unknown;
  note: string | null;
  sourceAsset: DbAssetRow & { bank: { id: string; name: string } };
  targetAsset: DbAssetRow & { bank: { id: string; name: string } };
};

type DbOperationRow = {
  id: string;
  assetId: string;
  operationType: 'BUY' | 'SELL';
  occurredAt: Date;
  quantity: unknown;
  priceLocal: unknown;
  feeLocal: unknown;
  fxToEur: unknown;
  grossLocal: unknown;
  netLocal: unknown;
  netEur: unknown;
  costBasisLocal: unknown;
  costBasisEur: unknown;
  realizedPnlEur: unknown;
  note: string | null;
  asset: DbAssetRow & { bank: { id: string; name: string } };
};

type DbBettingHouseRow = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

type DbBettingTransactionRow = {
  id: string;
  bettingHouseId: string;
  type: DbBettingTransactionType;
  amount: unknown;
  date: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  bettingHouse: DbBettingHouseRow;
};

type TransferDraftPayload = {
  date: string;
  sourceAssetId: string;
  targetAssetId: string;
  soldQuantity: number;
  sellPrice: number;
  sellFee: number;
  buyPrice: number;
  buyFee: number;
  note?: string;
  sourceFxToEur?: number;
  targetFxToEur?: number;
};

type StandaloneOperationDraftPayload = {
  date: string;
  assetId: string;
  type: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee: number;
  fxToEur?: number;
  note?: string;
};

type DashboardPayload = {
  banks: { id: string; name: string }[];
  assets: {
    id: string;
    bankId: string;
    name: string;
    type: ApiAssetType;
    currency: DbCurrency;
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
  }[];
  portfolioSummary: {
    positionValue: number;
    positionCost: number;
    realizedPnL: number;
    unrealizedPnL: number;
    totalPnL: number;
    profitability: number;
  };
  bankSummaries: {
    bankId: string;
    bankName: string;
    positionValue: number;
    positionCost: number;
    realizedPnL: number;
    unrealizedPnL: number;
    totalPnL: number;
    profitability: number;
  }[];
  visibleAssetMetrics: {
    assetId: string;
    bankId: string;
    bankName: string;
    name: string;
    type: ApiAssetType;
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
  }[];
  visibleMonthlySummary: {
    month: string;
    operations: number;
    soldAmount: number;
    boughtAmount: number;
    fees: number;
    realizedPnL: number;
  }[];
  filteredTransfers: {
    id: string;
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
    note: string;
  }[];
};

type BettingHouseSummary = {
  id: string;
  name: string;
  deposits: number;
  withdrawals: number;
  netInHouse: number;
};

type BettingTransactionItem = {
  id: string;
  bettingHouseId: string;
  bettingHouseName: string;
  type: DbBettingTransactionType;
  amount: number;
  date: string;
  note: string;
};

type BettingDashboardPayload = {
  year: number;
  houses: BettingHouseSummary[];
  transactions: BettingTransactionItem[];
  totals: {
    deposits: number;
    withdrawals: number;
    net: number;
  };
};

type BettingHouseItem = {
  id: string;
  name: string;
};

type EvolutionPoint = {
  month: string;
  bankId: string;
  bankName: string;
  positionValueEur: number;
  positionCostEur: number;
  realizedPnlEur: number;
  unrealizedPnlEur: number;
  totalPnlEur: number;
  profitability: number;
};

type EvolutionComparisons = {
  sinceInception: number;
  vsPreviousMonth: number | null;
  vsPreviousWeek: number | null;
  currentValueEur: number;
};

type EvolutionPayload = {
  monthlyItems: EvolutionPoint[];
  weeklyItems: EvolutionPoint[];
  comparisons: EvolutionComparisons;
};

function toNum(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    return Number(String(value));
  }
  return 0;
}

function round(value: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function yearDateRange(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1))
  };
}

function parseYearParam(value: unknown): number {
  const fallback = new Date().getFullYear();
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
    return fallback;
  }

  return parsed;
}

function mapAssetTypeFromApi(type: string): DbAssetType {
  if (type === "liquido") return "LIQUID";
  if (type === "fondo") return "FUND";
  if (type === "etf") return "ETF";
  if (type === "cripto") return "CRYPTO";
  if (type === "inmobiliario") return "REAL_ESTATE";
  return "STOCK";
}

function mapAssetTypeToApi(type: DbAssetType): ApiAssetType {
  if (type === "LIQUID") return "liquido";
  if (type === "FUND") return "fondo";
  if (type === "ETF") return "etf";
  if (type === "CRYPTO") return "cripto";
  if (type === "REAL_ESTATE") return "inmobiliario";
  return "accion";
}

function mapMarketProviderFromApi(provider: ApiMarketProvider): string {
  return provider;
}

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function validateTransferDraft(payload: TransferDraftPayload): string | null {
  if (!payload.sourceAssetId || !payload.targetAssetId) {
    return "Debe indicar activo origen y destino.";
  }
  if (payload.sourceAssetId === payload.targetAssetId) {
    return "Origen y destino deben ser activos diferentes.";
  }
  if (payload.soldQuantity <= 0 || payload.sellPrice <= 0 || payload.buyPrice <= 0) {
    return "Cantidad y precios deben ser mayores que cero.";
  }
  if (payload.sellFee < 0 || payload.buyFee < 0) {
    return "Las comisiones no pueden ser negativas.";
  }
  return null;
}

function validateStandaloneOperationDraft(payload: StandaloneOperationDraftPayload): string | null {
  if (!payload.assetId) {
    return 'Debe indicar activo.';
  }
  if (payload.type !== 'buy' && payload.type !== 'sell') {
    return 'Tipo de operacion invalido.';
  }
  if (payload.quantity <= 0 || payload.price <= 0) {
    return 'Cantidad y precio deben ser mayores que cero.';
  }
  if (payload.fee < 0) {
    return 'La comision no puede ser negativa.';
  }
  return null;
}

async function getBettingDashboardData(year: number): Promise<BettingDashboardPayload> {
  const { start, end } = yearDateRange(year);

  const [houses, transactions] = await Promise.all([
    prisma.bettingHouse.findMany({
      include: {
        transactions: {
          where: { date: { gte: start, lt: end } },
          orderBy: { date: 'desc' }
        }
      },
      orderBy: { name: 'asc' }
    }),
    prisma.bettingTransaction.findMany({
      where: { date: { gte: start, lt: end } },
      include: { bettingHouse: true },
      orderBy: { date: 'desc' }
    })
  ]);

  const houseSummaries = houses.map((house) => {
    const deposits = house.transactions
      .filter((transaction) => transaction.type === 'DEPOSIT')
      .reduce((sum, transaction) => sum + toNum(transaction.amount), 0);
    const withdrawals = house.transactions
      .filter((transaction) => transaction.type === 'WITHDRAWAL')
      .reduce((sum, transaction) => sum + toNum(transaction.amount), 0);

    return {
      id: house.id,
      name: house.name,
      deposits: round(deposits),
      withdrawals: round(withdrawals),
      netInHouse: round(deposits - withdrawals)
    };
  });

  const transactionItems = transactions.map((transaction: any) => ({
    id: transaction.id,
    bettingHouseId: transaction.bettingHouseId,
    bettingHouseName: transaction.bettingHouse?.name ?? 'Casa de apuestas',
    type: transaction.type,
    amount: round(toNum(transaction.amount)),
    date: transaction.date.toISOString().slice(0, 10),
    note: transaction.note ?? ''
  }));

  const totals = transactionItems.reduce(
    (acc, transaction) => {
      if (transaction.type === 'DEPOSIT') {
        acc.deposits += transaction.amount;
      } else {
        acc.withdrawals += transaction.amount;
      }

      acc.net = acc.deposits - acc.withdrawals;
      return acc;
    },
    {
      deposits: 0,
      withdrawals: 0,
      net: 0
    }
  );

  return {
    year,
    houses: houseSummaries,
    transactions: transactionItems,
    totals: {
      deposits: round(totals.deposits),
      withdrawals: round(totals.withdrawals),
      net: round(totals.net)
    }
  };
}

function computeDashboard(
  selectedBankId: string,
  banks: { id: string; name: string }[],
  assets: DbAssetRow[],
  transferRows: DbTransferRow[],
  operationRows: DbOperationRow[]
): DashboardPayload {
  const bankNameById = new Map(banks.map((bank) => [bank.id, bank.name]));

  const assetsApi = assets.map((asset) => ({
    id: asset.id,
    bankId: asset.bankId,
    name: asset.name,
    type: mapAssetTypeToApi(asset.type),
    currency: asset.currency,
    marketSymbol: asset.marketSymbol,
    marketProvider: asset.marketProvider,
    lastPriceSyncAt: asset.lastPriceSyncAt ? asset.lastPriceSyncAt.toISOString() : null,
    quantity: toNum(asset.quantity),
    marketPrice: toNum(asset.marketPriceEur),
    investedCost: toNum(asset.investedCostEur),
    totalBoughtQty: toNum(asset.totalBoughtQty),
    totalBoughtCost: toNum(asset.totalBoughtCostEur),
    totalSoldQty: toNum(asset.totalSoldQty),
    totalSoldCost: toNum(asset.totalSoldCostBasisEur),
    totalSoldProceeds: toNum(asset.totalSoldProceedsEur)
  }));

  const allAssetMetrics = assets.map((asset) => {
    const quantity = toNum(asset.quantity);
    const marketPrice = toNum(asset.marketPriceEur);
    const positionValue = round(quantity * marketPrice);
    const positionCost = toNum(asset.investedCostEur);
    const totalBoughtQty = toNum(asset.totalBoughtQty);
    const totalBoughtCost = toNum(asset.totalBoughtCostEur);
    const totalSoldQty = toNum(asset.totalSoldQty);
    const totalSoldCost = toNum(asset.totalSoldCostBasisEur);
    const totalSoldProceeds = toNum(asset.totalSoldProceedsEur);

    const avgBuyOpen = quantity > 0 ? positionCost / quantity : 0;
    const avgBuyHistorical = totalBoughtQty > 0 ? totalBoughtCost / totalBoughtQty : 0;
    const avgSellHistorical = totalSoldQty > 0 ? totalSoldProceeds / totalSoldQty : 0;
    const realizedPnL = totalSoldProceeds - totalSoldCost;
    const unrealizedPnL = positionValue - positionCost;
    const totalPnL = realizedPnL + unrealizedPnL;
    const profitability = totalBoughtCost > 0 ? totalPnL / totalBoughtCost : 0;

    return {
      assetId: asset.id,
      bankId: asset.bankId,
      bankName: bankNameById.get(asset.bankId) ?? "Banco",
      name: asset.name,
      type: mapAssetTypeToApi(asset.type),
      quantity: round(quantity),
      marketPrice: round(marketPrice),
      positionValue: round(positionValue),
      positionCost: round(positionCost),
      avgBuyOpen: round(avgBuyOpen),
      avgBuyHistorical: round(avgBuyHistorical),
      avgSellHistorical: round(avgSellHistorical),
      realizedPnL: round(realizedPnL),
      unrealizedPnL: round(unrealizedPnL),
      totalPnL: round(totalPnL),
      profitability: round(profitability, 6)
    };
  });

  const aggregatePortfolio = (rows: typeof allAssetMetrics) => {
    const totals = rows.reduce(
      (acc, row) => {
        acc.positionValue += row.positionValue;
        acc.positionCost += row.positionCost;
        acc.realizedPnL += row.realizedPnL;
        acc.unrealizedPnL += row.unrealizedPnL;
        acc.totalPnL += row.totalPnL;
        return acc;
      },
      {
        positionValue: 0,
        positionCost: 0,
        realizedPnL: 0,
        unrealizedPnL: 0,
        totalPnL: 0
      }
    );

    const historicalCost = rows.reduce((acc, row) => {
      const asset = assets.find((item) => item.id === row.assetId);
      return acc + (asset ? toNum(asset.totalBoughtCostEur) : 0);
    }, 0);

    return {
      positionValue: round(totals.positionValue),
      positionCost: round(totals.positionCost),
      realizedPnL: round(totals.realizedPnL),
      unrealizedPnL: round(totals.unrealizedPnL),
      totalPnL: round(totals.totalPnL),
      profitability: historicalCost > 0 ? round(totals.totalPnL / historicalCost, 6) : 0
    };
  };

  const bankSummaries = banks.map((bank) => {
    const rows = allAssetMetrics.filter((row) => row.bankId === bank.id);
    const summary = aggregatePortfolio(rows);
    return {
      bankId: bank.id,
      bankName: bank.name,
      ...summary
    };
  });

  const visibleAssetMetrics =
    selectedBankId === ALL_BANKS
      ? allAssetMetrics
      : allAssetMetrics.filter((row) => row.bankId === selectedBankId);

  const mappedTransfers = transferRows.map((tx) => ({
    id: tx.id,
    kind: 'transfer' as const,
    date: tx.occurredAt.toISOString().slice(0, 10),
    sourceAssetId: tx.sourceAssetId,
    sourceAssetName: tx.sourceAsset.name,
    sourceBankId: tx.sourceAsset.bankId,
    sourceBankName: tx.sourceAsset.bank.name,
    targetAssetId: tx.targetAssetId,
    targetAssetName: tx.targetAsset.name,
    targetBankId: tx.targetAsset.bankId,
    targetBankName: tx.targetAsset.bank.name,
    soldQuantity: toNum(tx.soldQuantity),
    sellPrice: toNum(tx.sellPriceLocal),
    sellFee: toNum(tx.sellFeeLocal),
    buyPrice: toNum(tx.buyPriceLocal),
    buyFee: toNum(tx.buyFeeLocal),
    boughtQuantity: toNum(tx.boughtQuantity),
    netProceeds: toNum(tx.soldNetEur),
    soldCostBasis: toNum(tx.soldCostBasisEur),
    realizedPnL: toNum(tx.realizedPnlEur),
    fxToEur: toNum(tx.sourceFxToEur),
    note: tx.note ?? "",
    occurredAt: tx.occurredAt.toISOString()
  }));

  const mappedOperations = operationRows.map((op) => {
    const isBuy = op.operationType === 'BUY';
    return {
      id: op.id,
      kind: 'operation' as const,
      operationType: isBuy ? 'buy' as const : 'sell' as const,
      date: op.occurredAt.toISOString().slice(0, 10),
      sourceAssetId: isBuy ? '' : op.assetId,
      sourceAssetName: isBuy ? 'Aporte externo' : op.asset.name,
      sourceBankId: op.asset.bankId,
      sourceBankName: op.asset.bank.name,
      targetAssetId: isBuy ? op.assetId : '',
      targetAssetName: isBuy ? op.asset.name : 'Salida externa',
      targetBankId: op.asset.bankId,
      targetBankName: op.asset.bank.name,
      soldQuantity: isBuy ? 0 : toNum(op.quantity),
      sellPrice: isBuy ? 0 : toNum(op.priceLocal),
      sellFee: isBuy ? 0 : toNum(op.feeLocal),
      buyPrice: isBuy ? toNum(op.priceLocal) : 0,
      buyFee: isBuy ? toNum(op.feeLocal) : 0,
      boughtQuantity: isBuy ? toNum(op.quantity) : 0,
      netProceeds: toNum(op.netEur),
      soldCostBasis: toNum(op.costBasisEur),
      realizedPnL: toNum(op.realizedPnlEur),
      fxToEur: toNum(op.fxToEur),
      note: op.note ?? '',
      occurredAt: op.occurredAt.toISOString()
    };
  });

  const allOperations = [...mappedTransfers, ...mappedOperations].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  const filteredTransfers =
    selectedBankId === ALL_BANKS
      ? allOperations
      : allOperations.filter(
          (tx) => tx.sourceBankId === selectedBankId || tx.targetBankId === selectedBankId
        );

  const monthMap = new Map<
    string,
    {
      month: string;
      operations: number;
      soldAmount: number;
      boughtAmount: number;
      fees: number;
      realizedPnL: number;
    }
  >();

  for (const tx of filteredTransfers) {
    const month = tx.date.slice(0, 7);
    const current = monthMap.get(month) ?? {
      month,
      operations: 0,
      soldAmount: 0,
      boughtAmount: 0,
      fees: 0,
      realizedPnL: 0
    };

    current.operations += 1;
    current.soldAmount += tx.netProceeds;
    current.boughtAmount += tx.boughtQuantity * tx.buyPrice + tx.buyFee;
    current.fees += tx.sellFee + tx.buyFee;
    current.realizedPnL += tx.realizedPnL;

    monthMap.set(month, current);
  }

  const visibleMonthlySummary = Array.from(monthMap.values())
    .map((row) => ({
      ...row,
      soldAmount: round(row.soldAmount),
      boughtAmount: round(row.boughtAmount),
      fees: round(row.fees),
      realizedPnL: round(row.realizedPnL)
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  return {
    banks,
    assets: assetsApi,
    portfolioSummary: aggregatePortfolio(allAssetMetrics),
    bankSummaries,
    visibleAssetMetrics,
    visibleMonthlySummary,
    filteredTransfers
  };
}

async function getDashboardData(selectedBankId = ALL_BANKS): Promise<DashboardPayload> {
  const [banks, assets, transfers, operations] = await Promise.all([
    prisma.bank.findMany({ orderBy: { name: "asc" } }),
    prisma.asset.findMany({ include: { assetType: true }, orderBy: { createdAt: "asc" } }),
    prisma.transfer.findMany({
      include: {
        sourceAsset: { include: { bank: true } },
        targetAsset: { include: { bank: true } }
      },
      orderBy: { occurredAt: "desc" }
    }),
    prisma.assetOperation.findMany({
      include: {
        asset: { include: { bank: true } }
      },
      orderBy: { occurredAt: 'desc' }
    })
  ]);

  const assetRows: DbAssetRow[] = assets.map((asset) => ({ ...asset, type: asset.assetType.code as DbAssetType }));

  return computeDashboard(selectedBankId, banks, assetRows, transfers as unknown as DbTransferRow[], operations as unknown as DbOperationRow[]);
}

function monthEndDate(month: string): Date {
  const start = parseMonthToDate(month);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59));
}

function parseCsvLine(line: string): string[] {
  return line.split(",").map((item) => item.trim());
}

async function fetchStooqPriceForMonth(symbol: string, month: string): Promise<number> {
  const target = monthEndDate(month);
  const encoded = encodeURIComponent(symbol.toLowerCase());
  const url = `https://stooq.com/q/d/l/?s=${encoded}&i=d`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`stooq no respondio (${response.status}).`);
  }

  const text = await response.text();
  if (text.toLowerCase().includes('get your apikey')) {
    return fetchStooqLatestPrice(symbol);
  }

  const lines = text.trim().split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length <= 1) {
    return fetchStooqLatestPrice(symbol);
  }

  const rows = lines.slice(1).map((line) => {
    const [dateStr, , , , closeStr] = parseCsvLine(line);
    return {
      date: new Date(`${dateStr}T23:59:59.000Z`),
      close: Number(closeStr)
    };
  });

  const candidate = rows
    .filter((row) => !Number.isNaN(row.close) && row.close > 0 && row.date <= target)
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0];

  if (!candidate) {
    return fetchStooqLatestPrice(symbol);
  }

  return candidate.close;
}

async function fetchStooqLatestPrice(symbol: string): Promise<number> {
  const encoded = encodeURIComponent(symbol.toLowerCase());
  const url = `https://stooq.com/q/l/?s=${encoded}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`stooq no respondio (${response.status}).`);
  }

  const text = (await response.text()).trim();
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const fields = parseCsvLine(firstLine);
  const close = Number(fields[6]);

  if (!close || Number.isNaN(close)) {
    throw new Error(`No se pudo leer precio en tiempo real para ${symbol} en stooq.`);
  }

  return close;
}

async function fetchAlphaVantagePriceForMonth(symbol: string, month: string): Promise<number> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error("Falta ALPHA_VANTAGE_API_KEY en .env.");
  }

  const target = monthEndDate(month);
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&outputsize=full&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Alpha Vantage no respondio (${response.status}).`);
  }

  const data = (await response.json()) as {
    'Time Series (Daily)'?: Record<string, { '4. close': string }>;
    Note?: string;
    Information?: string;
  };

  if (data.Note || data.Information) {
    throw new Error(data.Note ?? data.Information ?? 'Error de Alpha Vantage.');
  }

  const series = data['Time Series (Daily)'];
  if (!series) {
    throw new Error(`Alpha Vantage sin datos para ${symbol}.`);
  }

  const dates = Object.keys(series)
    .map((dateStr) => new Date(`${dateStr}T23:59:59.000Z`))
    .filter((date) => date <= target)
    .sort((a, b) => b.getTime() - a.getTime());

  if (dates.length === 0) {
    throw new Error(`Sin precios historicos de ${symbol} para ${month}.`);
  }

  const selectedDate = dates[0].toISOString().slice(0, 10);
  const close = Number(series[selectedDate]?.['4. close']);
  if (!close || Number.isNaN(close)) {
    throw new Error(`Precio invalido recibido para ${symbol}.`);
  }

  return close;
}

async function fetchYahooPriceForMonth(symbol: string, month: string): Promise<number> {
  const start = parseMonthToDate(month);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 23, 59, 59));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(start.getTime() / 1000)}&period2=${Math.floor(end.getTime() / 1000)}&interval=1d&includePrePost=false&events=div%2Csplits`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance no respondio (${response.status}).`);
  }

  const data = (await response.json()) as {
    chart?: {
      error?: { description?: string };
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };

  if (data.chart?.error?.description) {
    throw new Error(data.chart.error.description);
  }

  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  const entries = timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000),
      close: closes[index]
    }))
    .filter((entry) => entry.date <= end && typeof entry.close === 'number' && entry.close > 0)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  if (entries.length === 0) {
    throw new Error(`Yahoo Finance sin datos para ${symbol} en ${month}.`);
  }

  return entries[0].close as number;
}

async function fetchYahooFxRate(symbol: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&includePrePost=false&events=div%2Csplits`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance no respondio (${response.status}).`);
  }

  const data = (await response.json()) as {
    chart?: {
      error?: { description?: string };
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };

  if (data.chart?.error?.description) {
    throw new Error(data.chart.error.description);
  }

  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  const entries = timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000),
      close: closes[index]
    }))
    .filter((entry) => typeof entry.close === 'number' && entry.close > 0)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  if (entries.length === 0) {
    throw new Error(`Yahoo Finance sin datos para ${symbol}.`);
  }

  return entries[0].close as number;
}

async function fetchMarketPrice(provider: string, symbol: string, month: string): Promise<number> {
  const normalizedProvider = provider.toLowerCase();
  if (normalizedProvider === 'stooq') {
    return fetchStooqPriceForMonth(symbol, month);
  }
  if (normalizedProvider === 'alphavantage') {
    return fetchAlphaVantagePriceForMonth(symbol, month);
  }
  if (normalizedProvider === 'yahoo') {
    return fetchYahooPriceForMonth(symbol, month);
  }

  throw new Error(`Proveedor no soportado: ${provider}. Usa stooq, alphavantage o yahoo.`);
}

async function resolveFxToEur(currency: DbCurrency, month: string): Promise<number> {
  if (currency === 'EUR') {
    return 1;
  }

  const targetDate = monthEndDate(month);
  const fx = await prisma.fxRate.findFirst({
    where: {
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      date: { lte: targetDate }
    },
    orderBy: { date: 'desc' }
  });

  if (!fx) {
    throw new Error(`No hay tipo de cambio USD->EUR para ${month}.`);
  }

  return toNum(fx.rate);
}

async function syncMarketPricesForMonth(month: string): Promise<{
  month: string;
  updated: number;
  skipped: number;
  failed: Array<{ assetId: string; assetName: string; reason: string }>;
}> {
  const monthDate = parseMonthToDate(month);
  const investableAssets = await prisma.asset.findMany({
    where: {
      assetType: { code: { in: ['FUND', 'STOCK'] } }
    },
    orderBy: { name: 'asc' }
  });

  let updated = 0;
  let skipped = 0;
  const failed: Array<{ assetId: string; assetName: string; reason: string }> = [];

  for (const asset of investableAssets) {
    const symbol = asset.marketSymbol?.trim();
    const provider = (asset.marketProvider ?? 'stooq').trim();
    if (!symbol) {
      skipped += 1;
      continue;
    }

    try {
      const priceLocal = await fetchMarketPrice(provider, symbol, month);
      const fxToEur = await resolveFxToEur(asset.currency as DbCurrency, month);
      const priceEur = round(priceLocal * fxToEur);

      await prisma.$transaction(async (tx: any) => {
        await tx.asset.update({
          where: { id: asset.id },
          data: {
            marketPriceLocal: round(priceLocal),
            marketPriceEur: priceEur,
            lastPriceSyncAt: new Date()
          }
        });

        await tx.assetPriceHistory.upsert({
          where: {
            assetId_month: {
              assetId: asset.id,
              month: monthDate
            }
          },
          update: {
            provider,
            symbol,
            priceLocal: round(priceLocal),
            priceEur,
            fxToEur: round(fxToEur),
            syncedAt: new Date()
          },
          create: {
            assetId: asset.id,
            month: monthDate,
            provider,
            symbol,
            priceLocal: round(priceLocal),
            priceEur,
            fxToEur: round(fxToEur)
          }
        });

        await tx.assetPriceSyncLog.create({
          data: {
            assetId: asset.id,
            referenceMonth: monthDate,
            provider,
            symbol,
            priceLocal: round(priceLocal),
            priceEur,
            fxToEur: round(fxToEur)
          }
        });
      });

      updated += 1;
    } catch (error) {
      failed.push({
        assetId: asset.id,
        assetName: asset.name,
        reason: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  return { month, updated, skipped, failed };
}

function parseMonthToDate(month: string): Date {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Mes invalido. Usa formato YYYY-MM.");
  }

  return new Date(`${month}-01T00:00:00.000Z`);
}

function parseWeekToDate(week: string): Date {
  const match = week.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error("Semana invalida. Usa formato YYYY-Www.");
  }

  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (weekNumber < 1 || weekNumber > 53) {
    throw new Error("Semana invalida. Debe estar entre 01 y 53.");
  }

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - day + 1);

  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (weekNumber - 1) * 7);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

async function closeMonthEvolution(month: string): Promise<void> {
  const monthDate = parseMonthToDate(month);
  const dashboard = await getDashboardData(ALL_BANKS);

  await prisma.$transaction(async (tx: any) => {
    for (const summary of dashboard.bankSummaries) {
      await tx.monthlyPortfolioSnapshot.upsert({
        where: {
          bankId_month: {
            bankId: summary.bankId,
            month: monthDate
          }
        },
        update: {
          positionValueEur: summary.positionValue,
          positionCostEur: summary.positionCost,
          realizedPnlEur: summary.realizedPnL,
          unrealizedPnlEur: summary.unrealizedPnL,
          totalPnlEur: summary.totalPnL,
          profitability: summary.profitability
        },
        create: {
          bankId: summary.bankId,
          month: monthDate,
          positionValueEur: summary.positionValue,
          positionCostEur: summary.positionCost,
          realizedPnlEur: summary.realizedPnL,
          unrealizedPnlEur: summary.unrealizedPnL,
          totalPnlEur: summary.totalPnL,
          profitability: summary.profitability
        }
      });
    }
  });
}

async function closeWeekEvolution(week: string): Promise<void> {
  const weekDate = parseWeekToDate(week);
  const dashboard = await getDashboardData(ALL_BANKS);

  await prisma.$transaction(async (tx: any) => {
    for (const summary of dashboard.bankSummaries) {
      await tx.$executeRaw`
        INSERT INTO "weekly_portfolio_snapshots"
          ("bankId", "week", "positionValueEur", "positionCostEur", "realizedPnlEur", "unrealizedPnlEur", "totalPnlEur", "profitability")
        VALUES
          (${summary.bankId}, ${weekDate}, ${summary.positionValue}, ${summary.positionCost}, ${summary.realizedPnL}, ${summary.unrealizedPnL}, ${summary.totalPnL}, ${summary.profitability})
        ON CONFLICT ("bankId", "week") DO UPDATE SET
          "positionValueEur" = EXCLUDED."positionValueEur",
          "positionCostEur" = EXCLUDED."positionCostEur",
          "realizedPnlEur" = EXCLUDED."realizedPnlEur",
          "unrealizedPnlEur" = EXCLUDED."unrealizedPnlEur",
          "totalPnlEur" = EXCLUDED."totalPnlEur",
          "profitability" = EXCLUDED."profitability";
      `;
    }
  });
}

async function getEvolution(bankId: string): Promise<EvolutionPoint[]> {
  const snapshots = await prisma.monthlyPortfolioSnapshot.findMany({
    where: bankId === ALL_BANKS ? { bankId: { not: null } } : { bankId },
    include: { bank: true },
    orderBy: { month: "asc" }
  });

  if (bankId !== ALL_BANKS) {
    return snapshots.map((row: any) => ({
      month: row.month.toISOString().slice(0, 7),
      bankId: row.bankId ?? "",
      bankName: row.bank?.name ?? "Banco",
      positionValueEur: toNum(row.positionValueEur),
      positionCostEur: toNum(row.positionCostEur),
      realizedPnlEur: toNum(row.realizedPnlEur),
      unrealizedPnlEur: toNum(row.unrealizedPnlEur),
      totalPnlEur: toNum(row.totalPnlEur),
      profitability: toNum(row.profitability)
    }));
  }

  const monthlyMap = new Map<string, EvolutionPoint>();
  for (const row of snapshots) {
    const month = row.month.toISOString().slice(0, 7);
    const current = monthlyMap.get(month) ?? {
      month,
      bankId: ALL_BANKS,
      bankName: "Global",
      positionValueEur: 0,
      positionCostEur: 0,
      realizedPnlEur: 0,
      unrealizedPnlEur: 0,
      totalPnlEur: 0,
      profitability: 0
    };

    current.positionValueEur += toNum(row.positionValueEur);
    current.positionCostEur += toNum(row.positionCostEur);
    current.realizedPnlEur += toNum(row.realizedPnlEur);
    current.unrealizedPnlEur += toNum(row.unrealizedPnlEur);
    current.totalPnlEur += toNum(row.totalPnlEur);

    monthlyMap.set(month, current);
  }

  return Array.from(monthlyMap.values())
    .map((row) => ({
      ...row,
      positionValueEur: round(row.positionValueEur),
      positionCostEur: round(row.positionCostEur),
      realizedPnlEur: round(row.realizedPnlEur),
      unrealizedPnlEur: round(row.unrealizedPnlEur),
      totalPnlEur: round(row.totalPnlEur),
      profitability: row.positionCostEur > 0 ? round(row.totalPnlEur / row.positionCostEur, 6) : 0
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

async function getWeeklyEvolution(bankId: string): Promise<EvolutionPoint[]> {
  type WeeklySnapshotRow = {
    week: Date;
    bankId: string | null;
    bankName: string | null;
    positionValueEur: unknown;
    positionCostEur: unknown;
    realizedPnlEur: unknown;
    unrealizedPnlEur: unknown;
    totalPnlEur: unknown;
    profitability: unknown;
  };

  const snapshots =
    bankId === ALL_BANKS
      ? await prisma.$queryRaw<WeeklySnapshotRow[]>`
          SELECT
            ws."week",
            ws."bankId",
            b."name" AS "bankName",
            ws."positionValueEur",
            ws."positionCostEur",
            ws."realizedPnlEur",
            ws."unrealizedPnlEur",
            ws."totalPnlEur",
            ws."profitability"
          FROM "weekly_portfolio_snapshots" ws
          LEFT JOIN "banks" b ON b."id" = ws."bankId"
          WHERE ws."bankId" IS NOT NULL
          ORDER BY ws."week" ASC
        `
      : await prisma.$queryRaw<WeeklySnapshotRow[]>`
          SELECT
            ws."week",
            ws."bankId",
            b."name" AS "bankName",
            ws."positionValueEur",
            ws."positionCostEur",
            ws."realizedPnlEur",
            ws."unrealizedPnlEur",
            ws."totalPnlEur",
            ws."profitability"
          FROM "weekly_portfolio_snapshots" ws
          LEFT JOIN "banks" b ON b."id" = ws."bankId"
          WHERE ws."bankId" = ${bankId}
          ORDER BY ws."week" ASC
        `;

  if (bankId !== ALL_BANKS) {
    return snapshots.map((row: any) => ({
      month: `${row.week.toISOString().slice(0, 10)} (semana)`,
      bankId: row.bankId ?? '',
      bankName: row.bankName ?? 'Banco',
      positionValueEur: toNum(row.positionValueEur),
      positionCostEur: toNum(row.positionCostEur),
      realizedPnlEur: toNum(row.realizedPnlEur),
      unrealizedPnlEur: toNum(row.unrealizedPnlEur),
      totalPnlEur: toNum(row.totalPnlEur),
      profitability: toNum(row.profitability)
    }));
  }

  const weeklyMap = new Map<string, EvolutionPoint>();
  for (const row of snapshots) {
    const week = row.week.toISOString().slice(0, 10);
    const current = weeklyMap.get(week) ?? {
      month: `${week} (semana)`,
      bankId: ALL_BANKS,
      bankName: 'Global',
      positionValueEur: 0,
      positionCostEur: 0,
      realizedPnlEur: 0,
      unrealizedPnlEur: 0,
      totalPnlEur: 0,
      profitability: 0
    };

    current.positionValueEur += toNum(row.positionValueEur);
    current.positionCostEur += toNum(row.positionCostEur);
    current.realizedPnlEur += toNum(row.realizedPnlEur);
    current.unrealizedPnlEur += toNum(row.unrealizedPnlEur);
    current.totalPnlEur += toNum(row.totalPnlEur);
    weeklyMap.set(week, current);
  }

  return Array.from(weeklyMap.values())
    .map((row) => ({
      ...row,
      positionValueEur: round(row.positionValueEur),
      positionCostEur: round(row.positionCostEur),
      realizedPnlEur: round(row.realizedPnlEur),
      unrealizedPnlEur: round(row.unrealizedPnlEur),
      totalPnlEur: round(row.totalPnlEur),
      profitability: row.positionCostEur > 0 ? round(row.totalPnlEur / row.positionCostEur, 6) : 0
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

async function getEvolutionPayload(bankId: string): Promise<EvolutionPayload> {
  const [monthlyItems, weeklyItems, dashboard] = await Promise.all([
    getEvolution(bankId),
    getWeeklyEvolution(bankId),
    getDashboardData(bankId)
  ]);

  const currentValueEur = dashboard.portfolioSummary.positionValue;
  const latestMonthly = monthlyItems[monthlyItems.length - 1];
  const latestWeekly = weeklyItems[weeklyItems.length - 1];

  const vsPreviousMonth =
    latestMonthly && latestMonthly.positionValueEur > 0
      ? round((currentValueEur - latestMonthly.positionValueEur) / latestMonthly.positionValueEur, 6)
      : null;

  const vsPreviousWeek =
    latestWeekly && latestWeekly.positionValueEur > 0
      ? round((currentValueEur - latestWeekly.positionValueEur) / latestWeekly.positionValueEur, 6)
      : null;

  return {
    monthlyItems,
    weeklyItems,
    comparisons: {
      sinceInception: dashboard.portfolioSummary.profitability,
      vsPreviousMonth,
      vsPreviousWeek,
      currentValueEur
    }
  };
}

app.get(
  "/api/betting",
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYearParam(req.query.year);
    const payload = await getBettingDashboardData(year);
    res.json(payload);
  })
);

app.post(
  "/api/betting/houses",
  asyncHandler(async (req: Request, res: Response) => {
    const name = String(req.body?.name ?? '').trim();

    if (name.length < 2) {
      res.status(400).json({ message: 'El nombre de la casa debe tener al menos 2 caracteres.' });
      return;
    }

    try {
      const house = await prisma.bettingHouse.create({ data: { name } });
      const payload: BettingHouseItem = { id: house.id, name: house.name };
      res.status(201).json(payload);
      return;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        res.status(409).json({ message: 'Ya existe una casa con ese nombre.' });
        return;
      }

      throw error;
    }
  })
);

app.delete(
  '/api/betting/houses/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYearParam(req.query.year);
    const id = String(req.params.id ?? '');

    try {
      await prisma.bettingHouse.delete({ where: { id } });
      res.json(await getBettingDashboardData(year));
    } catch {
      res.status(404).json({ message: 'Casa de apuestas no encontrada' });
    }
  })
);

app.post(
  '/api/betting/transactions',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYearParam(req.query.year);
    const bettingHouseId = String(req.body?.bettingHouseId ?? '').trim();
    const type = String(req.body?.type ?? '').toUpperCase() as DbBettingTransactionType;
    const amount = Number(req.body?.amount ?? 0);
    const date = new Date(String(req.body?.date ?? ''));
    const note = String(req.body?.note ?? '').trim();

    if (!bettingHouseId) {
      res.status(400).json({ message: 'Debe indicar la casa de apuestas.' });
      return;
    }

    if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') {
      res.status(400).json({ message: 'Tipo de movimiento no válido.' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ message: 'El importe debe ser mayor que cero.' });
      return;
    }

    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ message: 'La fecha no es válida.' });
      return;
    }

    const house = await prisma.bettingHouse.findUnique({ where: { id: bettingHouseId } });
    if (!house) {
      res.status(404).json({ message: 'Casa de apuestas no encontrada' });
      return;
    }

    await prisma.bettingTransaction.create({
      data: {
        bettingHouseId,
        type,
        amount,
        date,
        note: note.length > 0 ? note : null
      }
    });

    res.json(await getBettingDashboardData(year));
  })
);

app.delete(
  '/api/betting/transactions/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseYearParam(req.query.year);
    const id = String(req.params.id ?? '');

    try {
      await prisma.bettingTransaction.delete({ where: { id } });
      res.json(await getBettingDashboardData(year));
    } catch {
      res.status(404).json({ message: 'Movimiento no encontrado' });
    }
  })
);

app.get(
  "/api/dashboard",
  asyncHandler(async (req: Request, res: Response) => {
    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const payload = await getDashboardData(selectedBankId);
    res.json(payload);
  })
);

app.get(
  "/api/bootstrap",
  asyncHandler(async (req: Request, res: Response) => {
    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const payload = await getDashboardData(selectedBankId);
    res.json(payload);
  })
);

app.post(
  "/api/banks",
  asyncHandler(async (req: Request, res: Response) => {
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 2) {
      res.status(400).json({ message: "El nombre del banco debe tener al menos 2 caracteres." });
      return;
    }

    try {
      await prisma.bank.create({ data: { name } });
    } catch {
      res.status(409).json({ message: "Ese banco ya existe." });
      return;
    }

    const payload = await getDashboardData(ALL_BANKS);
    res.status(201).json(payload);
  })
);

app.patch(
  "/api/banks/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const name = String(req.body?.name ?? "").trim();

    if (name.length < 2) {
      res.status(400).json({ message: "El nombre del banco debe tener al menos 2 caracteres." });
      return;
    }

    const existing = await prisma.bank.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Banco no encontrado." });
      return;
    }

    try {
      await prisma.bank.update({
        where: { id },
        data: { name }
      });
    } catch {
      res.status(409).json({ message: "No se pudo actualizar el banco (nombre ya existente)." });
      return;
    }

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const payload = await getDashboardData(selectedBankId);
    res.json(payload);
  })
);

app.post(
  "/api/assets",
  asyncHandler(async (req: Request, res: Response) => {
    const bankId = String(req.body?.bankId ?? "");
    const name = String(req.body?.name ?? "").trim();
    const type = mapAssetTypeFromApi(String(req.body?.type ?? "accion"));
    const quantity = Number(req.body?.quantity ?? 0);
    const avgBuyPrice = Number(req.body?.avgBuyPrice ?? 0);
    const marketPrice = Number(req.body?.marketPrice ?? 0);
    const currency: DbCurrency = String(req.body?.currency ?? "EUR") === "USD" ? "USD" : "EUR";
    const marketSymbol = String(req.body?.marketSymbol ?? "").trim();
    const marketProvider = String(req.body?.marketProvider ?? "stooq").trim().toLowerCase();

    if (!bankId || name.length < 2) {
      res.status(400).json({ message: "Datos de activo no validos." });
      return;
    }

    if (quantity < 0 || avgBuyPrice < 0 || marketPrice < 0) {
      res.status(400).json({ message: "Los valores numericos no pueden ser negativos." });
      return;
    }

    const normalizedAvg = type === "LIQUID" ? 1 : avgBuyPrice;
    const normalizedMarket = type === "LIQUID" ? 1 : marketPrice;
    const investedCostLocal = round(quantity * normalizedAvg);
    const investedCostEur = currency === "USD" ? round(investedCostLocal) : round(investedCostLocal);
    const marketPriceEur = currency === "USD" ? round(normalizedMarket) : round(normalizedMarket);

    const assetType = await prisma.assetTypeEntity.findUnique({ where: { code: type } });
    if (!assetType) {
      res.status(400).json({ message: "Tipo de activo no valido." });
      return;
    }

    try {
      await prisma.asset.create({
        data: {
          bankId,
          name,
          assetTypeId: assetType.id,
          currency,
          marketSymbol: marketSymbol.length > 0 ? marketSymbol : null,
          marketProvider: marketProvider.length > 0 ? marketProvider : "stooq",
          quantity,
          investedCostLocal,
          investedCostEur,
          marketPriceLocal: normalizedMarket,
          marketPriceEur,
          totalBoughtQty: quantity,
          totalBoughtCostLocal: investedCostLocal,
          totalBoughtCostEur: investedCostEur,
          totalSoldQty: 0,
          totalSoldProceedsLocal: 0,
          totalSoldProceedsEur: 0,
          totalSoldCostBasisLocal: 0,
          totalSoldCostBasisEur: 0
        }
      });
    } catch {
      res.status(409).json({ message: "No se pudo crear el activo (puede que ya exista en ese banco)." });
      return;
    }

    const payload = await getDashboardData(ALL_BANKS);
    res.status(201).json(payload);
  })
);

app.patch(
  "/api/assets/:id/price",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const marketPrice = Number(req.body?.marketPrice ?? 0);
    if (marketPrice < 0) {
      res.status(400).json({ message: "Precio invalido." });
      return;
    }

    const existing = await prisma.asset.findUnique({ where: { id }, include: { assetType: true } });
    if (!existing) {
      res.status(404).json({ message: "Activo no encontrado." });
      return;
    }

    const normalizedPrice = existing.assetType.code === "LIQUID" ? 1 : marketPrice;
    const marketPriceEur =
      existing.currency === "USD"
        ? round(normalizedPrice * toNum(existing.marketPriceEur) / Math.max(toNum(existing.marketPriceLocal), 1e-8))
        : normalizedPrice;

    await prisma.asset.update({
      where: { id },
      data: {
        marketPriceLocal: normalizedPrice,
        marketPriceEur: round(marketPriceEur)
      }
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const payload = await getDashboardData(selectedBankId);
    res.json(payload);
  })
);

app.patch(
  "/api/assets/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const name = String(req.body?.name ?? "").trim();
    const avgBuyPrice = Number(req.body?.avgBuyPrice ?? 0);
    const marketPrice = Number(req.body?.marketPrice ?? 0);
    const marketSymbolRaw = String(req.body?.marketSymbol ?? "").trim();
    const marketProviderRaw = String(req.body?.marketProvider ?? "stooq").trim().toLowerCase();

    if (name.length < 2) {
      res.status(400).json({ message: "El nombre del activo debe tener al menos 2 caracteres." });
      return;
    }

    if (marketPrice < 0) {
      res.status(400).json({ message: "Precio invalido." });
      return;
    }

    if (avgBuyPrice < 0) {
      res.status(400).json({ message: "Precio inicial invalido." });
      return;
    }

    if (marketProviderRaw !== "stooq" && marketProviderRaw !== "alphavantage" && marketProviderRaw !== "yahoo") {
      res.status(400).json({ message: "Proveedor invalido. Usa stooq, alphavantage o yahoo." });
      return;
    }

    const existing = await prisma.asset.findUnique({ where: { id }, include: { assetType: true } });
    if (!existing) {
      res.status(404).json({ message: "Activo no encontrado." });
      return;
    }

    const normalizedPrice = existing.assetType.code === "LIQUID" ? 1 : marketPrice;
    const normalizedAvgBuy = existing.assetType.code === "LIQUID" ? 1 : avgBuyPrice;
    const marketPriceEur =
      existing.currency === "USD"
        ? round(normalizedPrice * toNum(existing.marketPriceEur) / Math.max(toNum(existing.marketPriceLocal), 1e-8))
        : normalizedPrice;

    const quantity = toNum(existing.quantity);
    const previousInvestedLocal = toNum(existing.investedCostLocal);
    const previousInvestedEur = toNum(existing.investedCostEur);
    const updatedInvestedLocal = round(quantity * normalizedAvgBuy);
    const updatedInvestedEur =
      existing.currency === "USD"
        ? round(updatedInvestedLocal * toNum(existing.investedCostEur) / Math.max(toNum(existing.investedCostLocal), 1e-8))
        : updatedInvestedLocal;

    const deltaInvestedLocal = round(updatedInvestedLocal - previousInvestedLocal);
    const deltaInvestedEur = round(updatedInvestedEur - previousInvestedEur);

    await prisma.asset.update({
      where: { id },
      data: {
        name,
        investedCostLocal: updatedInvestedLocal,
        investedCostEur: updatedInvestedEur,
        totalBoughtCostLocal: round(Math.max(0, toNum(existing.totalBoughtCostLocal) + deltaInvestedLocal)),
        totalBoughtCostEur: round(Math.max(0, toNum(existing.totalBoughtCostEur) + deltaInvestedEur)),
        marketPriceLocal: normalizedPrice,
        marketPriceEur: round(marketPriceEur),
        marketSymbol: marketSymbolRaw.length > 0 ? marketSymbolRaw : null,
        marketProvider: marketProviderRaw
      }
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const payload = await getDashboardData(selectedBankId);
    res.json(payload);
  })
);

app.patch(
  "/api/assets/:id/market-config",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const marketSymbolRaw = String(req.body?.marketSymbol ?? "").trim();
    const marketProviderRaw = String(req.body?.marketProvider ?? "stooq").trim().toLowerCase();

    if (marketProviderRaw !== 'stooq' && marketProviderRaw !== 'alphavantage' && marketProviderRaw !== 'yahoo') {
      res.status(400).json({ message: 'Proveedor invalido. Usa stooq, alphavantage o yahoo.' });
      return;
    }

    const existing = await prisma.asset.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Activo no encontrado.' });
      return;
    }

    await prisma.asset.update({
      where: { id },
      data: {
        marketSymbol: marketSymbolRaw.length > 0 ? marketSymbolRaw : null,
        marketProvider: marketProviderRaw
      }
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const payload = await getDashboardData(selectedBankId);
    res.json(payload);
  })
);

app.post(
  "/api/prices/sync-month",
  asyncHandler(async (req: Request, res: Response) => {
    const month = String(req.body?.month ?? "");
    const result = await syncMarketPricesForMonth(month);
    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const dashboard = await getDashboardData(selectedBankId);
    res.status(201).json({
      sync: result,
      dashboard
    });
  })
);

app.post(
  "/api/transfers",
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body as TransferDraftPayload;
    const sourceFxToEur = Number(payload.sourceFxToEur ?? 1);
    const targetFxToEur = Number(payload.targetFxToEur ?? 1);
    const validationError = validateTransferDraft(payload);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    await prisma.$transaction(async (tx: any) => {
      const source = await tx.asset.findUnique({ where: { id: payload.sourceAssetId } });
      const target = await tx.asset.findUnique({ where: { id: payload.targetAssetId } });

      if (!source || !target) {
        throw new Error("No se encontro el activo de origen o destino.");
      }

      const sourceQty = toNum(source.quantity);
      const sourceCostEur = toNum(source.investedCostEur);
      const sourceCostLocal = toNum(source.investedCostLocal);

      if (sourceQty < payload.soldQuantity) {
        throw new Error("No hay suficiente cantidad en el activo origen para vender.");
      }

      const sourceOpenAvgEur = sourceQty > 0 ? sourceCostEur / sourceQty : 0;
      const sourceOpenAvgLocal = sourceQty > 0 ? sourceCostLocal / sourceQty : 0;
      const soldCostBasisEur = round(sourceOpenAvgEur * payload.soldQuantity);
      const soldCostBasisLocal = round(sourceOpenAvgLocal * payload.soldQuantity);

      const soldNetLocal = round(payload.soldQuantity * payload.sellPrice - payload.sellFee);
      if (soldNetLocal <= payload.buyFee) {
        throw new Error("El efectivo neto de la venta no cubre la comision de compra.");
      }

      const soldNetEur = round(soldNetLocal * sourceFxToEur);
      const realizedPnlLocal = round(soldNetLocal - soldCostBasisLocal);
      const realizedPnlEur = round(soldNetEur - soldCostBasisEur);

      const amountForBuyLocal = round(soldNetLocal - payload.buyFee);
      const boughtQuantity = round(amountForBuyLocal / payload.buyPrice);
      const buyCostLocal = round(boughtQuantity * payload.buyPrice + payload.buyFee);
      const buyCostEur = round(buyCostLocal * targetFxToEur);

      await tx.asset.update({
        where: { id: source.id },
        data: {
          quantity: round(sourceQty - payload.soldQuantity),
          investedCostLocal: round(Math.max(0, sourceCostLocal - soldCostBasisLocal)),
          investedCostEur: round(Math.max(0, sourceCostEur - soldCostBasisEur)),
          totalSoldQty: round(toNum(source.totalSoldQty) + payload.soldQuantity),
          totalSoldCostBasisLocal: round(toNum(source.totalSoldCostBasisLocal) + soldCostBasisLocal),
          totalSoldCostBasisEur: round(toNum(source.totalSoldCostBasisEur) + soldCostBasisEur),
          totalSoldProceedsLocal: round(toNum(source.totalSoldProceedsLocal) + soldNetLocal),
          totalSoldProceedsEur: round(toNum(source.totalSoldProceedsEur) + soldNetEur),
          marketPriceLocal: payload.sellPrice,
          marketPriceEur: round(payload.sellPrice * sourceFxToEur)
        }
      });

      await tx.asset.update({
        where: { id: target.id },
        data: {
          quantity: round(toNum(target.quantity) + boughtQuantity),
          investedCostLocal: round(toNum(target.investedCostLocal) + buyCostLocal),
          investedCostEur: round(toNum(target.investedCostEur) + buyCostEur),
          totalBoughtQty: round(toNum(target.totalBoughtQty) + boughtQuantity),
          totalBoughtCostLocal: round(toNum(target.totalBoughtCostLocal) + buyCostLocal),
          totalBoughtCostEur: round(toNum(target.totalBoughtCostEur) + buyCostEur),
          marketPriceLocal: payload.buyPrice,
          marketPriceEur: round(payload.buyPrice * targetFxToEur)
        }
      });

      await tx.transfer.create({
        data: {
          occurredAt: new Date(payload.date),
          note: payload.note?.trim() || null,
          sourceAssetId: source.id,
          sourceCurrency: source.currency,
          soldQuantity: payload.soldQuantity,
          sellPriceLocal: payload.sellPrice,
          sellFeeLocal: payload.sellFee,
          sourceFxToEur,
          soldCostBasisLocal,
          soldCostBasisEur,
          soldNetLocal,
          soldNetEur,
          realizedPnlLocal,
          realizedPnlEur,
          targetAssetId: target.id,
          targetCurrency: target.currency,
          buyPriceLocal: payload.buyPrice,
          buyFeeLocal: payload.buyFee,
          targetFxToEur,
          boughtQuantity,
          buyCostLocal,
          buyCostEur
        }
      });
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const dashboard = await getDashboardData(selectedBankId);
    res.status(201).json(dashboard);
  })
);

app.patch(
  '/api/transfers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const transferId = String(req.params.id);
    const payload = req.body as TransferDraftPayload;
    const sourceFxToEur = Number(payload.sourceFxToEur ?? 1);
    const targetFxToEur = Number(payload.targetFxToEur ?? 1);
    const validationError = validateTransferDraft(payload);

    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    await prisma.$transaction(async (tx: any) => {
      const existing = await tx.transfer.findUnique({
        where: { id: transferId },
        include: {
          sourceAsset: { include: { bank: true } },
          targetAsset: { include: { bank: true } }
        }
      });

      if (!existing) {
        throw new Error('Transaccion no encontrada.');
      }

      await tx.asset.update({
        where: { id: existing.sourceAssetId },
        data: {
          quantity: round(toNum(existing.sourceAsset.quantity) + toNum(existing.soldQuantity)),
          investedCostLocal: round(toNum(existing.sourceAsset.investedCostLocal) + toNum(existing.soldCostBasisLocal)),
          investedCostEur: round(toNum(existing.sourceAsset.investedCostEur) + toNum(existing.soldCostBasisEur)),
          totalSoldQty: round(toNum(existing.sourceAsset.totalSoldQty) - toNum(existing.soldQuantity)),
          totalSoldCostBasisLocal: round(toNum(existing.sourceAsset.totalSoldCostBasisLocal) - toNum(existing.soldCostBasisLocal)),
          totalSoldCostBasisEur: round(toNum(existing.sourceAsset.totalSoldCostBasisEur) - toNum(existing.soldCostBasisEur)),
          totalSoldProceedsLocal: round(toNum(existing.sourceAsset.totalSoldProceedsLocal) - toNum(existing.soldNetLocal)),
          totalSoldProceedsEur: round(toNum(existing.sourceAsset.totalSoldProceedsEur) - toNum(existing.soldNetEur)),
          marketPriceLocal: toNum(existing.sellPriceLocal),
          marketPriceEur: round(toNum(existing.sellPriceLocal) * toNum(existing.sourceFxToEur))
        }
      });

      await tx.asset.update({
        where: { id: existing.targetAssetId },
        data: {
          quantity: round(toNum(existing.targetAsset.quantity) - toNum(existing.boughtQuantity)),
          investedCostLocal: round(toNum(existing.targetAsset.investedCostLocal) - toNum(existing.buyCostLocal)),
          investedCostEur: round(toNum(existing.targetAsset.investedCostEur) - toNum(existing.buyCostEur)),
          totalBoughtQty: round(toNum(existing.targetAsset.totalBoughtQty) - toNum(existing.boughtQuantity)),
          totalBoughtCostLocal: round(toNum(existing.targetAsset.totalBoughtCostLocal) - toNum(existing.buyCostLocal)),
          totalBoughtCostEur: round(toNum(existing.targetAsset.totalBoughtCostEur) - toNum(existing.buyCostEur)),
          marketPriceLocal: toNum(existing.buyPriceLocal),
          marketPriceEur: round(toNum(existing.buyPriceLocal) * toNum(existing.targetFxToEur))
        }
      });

      const source = await tx.asset.findUnique({ where: { id: payload.sourceAssetId } });
      const target = await tx.asset.findUnique({ where: { id: payload.targetAssetId } });

      if (!source || !target) {
        throw new Error('No se encontro el activo de origen o destino.');
      }

      const sourceQty = toNum(source.quantity);
      const sourceCostEur = toNum(source.investedCostEur);
      const sourceCostLocal = toNum(source.investedCostLocal);

      if (sourceQty < payload.soldQuantity) {
        throw new Error('No hay suficiente cantidad en el activo origen para vender.');
      }

      const sourceOpenAvgEur = sourceQty > 0 ? sourceCostEur / sourceQty : 0;
      const sourceOpenAvgLocal = sourceQty > 0 ? sourceCostLocal / sourceQty : 0;
      const soldCostBasisEur = round(sourceOpenAvgEur * payload.soldQuantity);
      const soldCostBasisLocal = round(sourceOpenAvgLocal * payload.soldQuantity);

      const soldNetLocal = round(payload.soldQuantity * payload.sellPrice - payload.sellFee);
      if (soldNetLocal <= payload.buyFee) {
        throw new Error('El efectivo neto de la venta no cubre la comision de compra.');
      }

      const soldNetEur = round(soldNetLocal * sourceFxToEur);
      const realizedPnlLocal = round(soldNetLocal - soldCostBasisLocal);
      const realizedPnlEur = round(soldNetEur - soldCostBasisEur);

      const amountForBuyLocal = round(soldNetLocal - payload.buyFee);
      const boughtQuantity = round(amountForBuyLocal / payload.buyPrice);
      const buyCostLocal = round(boughtQuantity * payload.buyPrice + payload.buyFee);
      const buyCostEur = round(buyCostLocal * targetFxToEur);

      await tx.asset.update({
        where: { id: source.id },
        data: {
          quantity: round(sourceQty - payload.soldQuantity),
          investedCostLocal: round(Math.max(0, sourceCostLocal - soldCostBasisLocal)),
          investedCostEur: round(Math.max(0, sourceCostEur - soldCostBasisEur)),
          totalSoldQty: round(toNum(source.totalSoldQty) + payload.soldQuantity),
          totalSoldCostBasisLocal: round(toNum(source.totalSoldCostBasisLocal) + soldCostBasisLocal),
          totalSoldCostBasisEur: round(toNum(source.totalSoldCostBasisEur) + soldCostBasisEur),
          totalSoldProceedsLocal: round(toNum(source.totalSoldProceedsLocal) + soldNetLocal),
          totalSoldProceedsEur: round(toNum(source.totalSoldProceedsEur) + soldNetEur),
          marketPriceLocal: payload.sellPrice,
          marketPriceEur: round(payload.sellPrice * sourceFxToEur)
        }
      });

      await tx.asset.update({
        where: { id: target.id },
        data: {
          quantity: round(toNum(target.quantity) + boughtQuantity),
          investedCostLocal: round(toNum(target.investedCostLocal) + buyCostLocal),
          investedCostEur: round(toNum(target.investedCostEur) + buyCostEur),
          totalBoughtQty: round(toNum(target.totalBoughtQty) + boughtQuantity),
          totalBoughtCostLocal: round(toNum(target.totalBoughtCostLocal) + buyCostLocal),
          totalBoughtCostEur: round(toNum(target.totalBoughtCostEur) + buyCostEur),
          marketPriceLocal: payload.buyPrice,
          marketPriceEur: round(payload.buyPrice * targetFxToEur)
        }
      });

      await tx.transfer.update({
        where: { id: existing.id },
        data: {
          occurredAt: new Date(payload.date),
          note: payload.note?.trim() || null,
          sourceAssetId: source.id,
          sourceCurrency: source.currency,
          soldQuantity: payload.soldQuantity,
          sellPriceLocal: payload.sellPrice,
          sellFeeLocal: payload.sellFee,
          sourceFxToEur,
          soldCostBasisLocal,
          soldCostBasisEur,
          soldNetLocal,
          soldNetEur,
          realizedPnlLocal,
          realizedPnlEur,
          targetAssetId: target.id,
          targetCurrency: target.currency,
          buyPriceLocal: payload.buyPrice,
          buyFeeLocal: payload.buyFee,
          targetFxToEur,
          boughtQuantity,
          buyCostLocal,
          buyCostEur
        }
      });
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const dashboard = await getDashboardData(selectedBankId);
    res.status(200).json(dashboard);
  })
);

app.delete(
  '/api/transfers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const transferId = String(req.params.id);

    await prisma.$transaction(async (tx: any) => {
      const existing = await tx.transfer.findUnique({
        where: { id: transferId },
        include: {
          sourceAsset: true,
          targetAsset: true
        }
      });

      if (!existing) {
        throw new Error('Transaccion no encontrada.');
      }

      await tx.asset.update({
        where: { id: existing.sourceAssetId },
        data: {
          quantity: round(toNum(existing.sourceAsset.quantity) + toNum(existing.soldQuantity)),
          investedCostLocal: round(toNum(existing.sourceAsset.investedCostLocal) + toNum(existing.soldCostBasisLocal)),
          investedCostEur: round(toNum(existing.sourceAsset.investedCostEur) + toNum(existing.soldCostBasisEur)),
          totalSoldQty: round(toNum(existing.sourceAsset.totalSoldQty) - toNum(existing.soldQuantity)),
          totalSoldCostBasisLocal: round(toNum(existing.sourceAsset.totalSoldCostBasisLocal) - toNum(existing.soldCostBasisLocal)),
          totalSoldCostBasisEur: round(toNum(existing.sourceAsset.totalSoldCostBasisEur) - toNum(existing.soldCostBasisEur)),
          totalSoldProceedsLocal: round(toNum(existing.sourceAsset.totalSoldProceedsLocal) - toNum(existing.soldNetLocal)),
          totalSoldProceedsEur: round(toNum(existing.sourceAsset.totalSoldProceedsEur) - toNum(existing.soldNetEur)),
          marketPriceLocal: toNum(existing.sellPriceLocal),
          marketPriceEur: round(toNum(existing.sellPriceLocal) * toNum(existing.sourceFxToEur))
        }
      });

      await tx.asset.update({
        where: { id: existing.targetAssetId },
        data: {
          quantity: round(toNum(existing.targetAsset.quantity) - toNum(existing.boughtQuantity)),
          investedCostLocal: round(toNum(existing.targetAsset.investedCostLocal) - toNum(existing.buyCostLocal)),
          investedCostEur: round(toNum(existing.targetAsset.investedCostEur) - toNum(existing.buyCostEur)),
          totalBoughtQty: round(toNum(existing.targetAsset.totalBoughtQty) - toNum(existing.boughtQuantity)),
          totalBoughtCostLocal: round(toNum(existing.targetAsset.totalBoughtCostLocal) - toNum(existing.buyCostLocal)),
          totalBoughtCostEur: round(toNum(existing.targetAsset.totalBoughtCostEur) - toNum(existing.buyCostEur)),
          marketPriceLocal: toNum(existing.buyPriceLocal),
          marketPriceEur: round(toNum(existing.buyPriceLocal) * toNum(existing.targetFxToEur))
        }
      });

      await tx.transfer.delete({ where: { id: existing.id } });
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const dashboard = await getDashboardData(selectedBankId);
    res.status(200).json(dashboard);
  })
);

app.post(
  '/api/operations',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body as StandaloneOperationDraftPayload;
    const fxToEur = Number(payload.fxToEur ?? 1);
    const validationError = validateStandaloneOperationDraft(payload);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    await prisma.$transaction(async (tx: any) => {
      const asset = await tx.asset.findUnique({ where: { id: payload.assetId } });
      if (!asset) {
        throw new Error('Activo no encontrado.');
      }

      const quantity = Number(payload.quantity);
      const price = Number(payload.price);
      const fee = Number(payload.fee);
      const grossLocal = round(quantity * price);

      if (payload.type === 'buy') {
        const netLocal = round(grossLocal + fee);
        const netEur = round(netLocal * fxToEur);

        await tx.asset.update({
          where: { id: asset.id },
          data: {
            quantity: round(toNum(asset.quantity) + quantity),
            investedCostLocal: round(toNum(asset.investedCostLocal) + netLocal),
            investedCostEur: round(toNum(asset.investedCostEur) + netEur),
            totalBoughtQty: round(toNum(asset.totalBoughtQty) + quantity),
            totalBoughtCostLocal: round(toNum(asset.totalBoughtCostLocal) + netLocal),
            totalBoughtCostEur: round(toNum(asset.totalBoughtCostEur) + netEur),
            marketPriceLocal: price,
            marketPriceEur: round(price * fxToEur)
          }
        });

        await tx.assetOperation.create({
          data: {
            assetId: asset.id,
            operationType: 'BUY',
            occurredAt: new Date(payload.date),
            quantity,
            priceLocal: price,
            feeLocal: fee,
            fxToEur,
            grossLocal,
            grossEur: round(grossLocal * fxToEur),
            netLocal,
            netEur,
            costBasisLocal: 0,
            costBasisEur: 0,
            realizedPnlLocal: 0,
            realizedPnlEur: 0,
            note: payload.note?.trim() || null
          }
        });
      } else {
        const currentQty = toNum(asset.quantity);
        if (currentQty < quantity) {
          throw new Error('No hay suficiente cantidad para vender.');
        }

        const avgCostLocal = currentQty > 0 ? toNum(asset.investedCostLocal) / currentQty : 0;
        const avgCostEur = currentQty > 0 ? toNum(asset.investedCostEur) / currentQty : 0;
        const costBasisLocal = round(avgCostLocal * quantity);
        const costBasisEur = round(avgCostEur * quantity);
        const netLocal = round(grossLocal - fee);
        const netEur = round(netLocal * fxToEur);
        const realizedPnlLocal = round(netLocal - costBasisLocal);
        const realizedPnlEur = round(netEur - costBasisEur);

        await tx.asset.update({
          where: { id: asset.id },
          data: {
            quantity: round(currentQty - quantity),
            investedCostLocal: round(Math.max(0, toNum(asset.investedCostLocal) - costBasisLocal)),
            investedCostEur: round(Math.max(0, toNum(asset.investedCostEur) - costBasisEur)),
            totalSoldQty: round(toNum(asset.totalSoldQty) + quantity),
            totalSoldCostBasisLocal: round(toNum(asset.totalSoldCostBasisLocal) + costBasisLocal),
            totalSoldCostBasisEur: round(toNum(asset.totalSoldCostBasisEur) + costBasisEur),
            totalSoldProceedsLocal: round(toNum(asset.totalSoldProceedsLocal) + netLocal),
            totalSoldProceedsEur: round(toNum(asset.totalSoldProceedsEur) + netEur),
            marketPriceLocal: price,
            marketPriceEur: round(price * fxToEur)
          }
        });

        await tx.assetOperation.create({
          data: {
            assetId: asset.id,
            operationType: 'SELL',
            occurredAt: new Date(payload.date),
            quantity,
            priceLocal: price,
            feeLocal: fee,
            fxToEur,
            grossLocal,
            grossEur: round(grossLocal * fxToEur),
            netLocal,
            netEur,
            costBasisLocal,
            costBasisEur,
            realizedPnlLocal,
            realizedPnlEur,
            note: payload.note?.trim() || null
          }
        });
      }
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const dashboard = await getDashboardData(selectedBankId);
    res.status(201).json(dashboard);
  })
);

app.patch(
  '/api/operations/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const operationId = String(req.params.id);
    const payload = req.body as StandaloneOperationDraftPayload;
    const fxToEur = Number(payload.fxToEur ?? 1);
    const validationError = validateStandaloneOperationDraft(payload);

    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    await prisma.$transaction(async (tx: any) => {
      const existing = await tx.assetOperation.findUnique({
        where: { id: operationId },
        include: { asset: { include: { bank: true } } }
      });

      if (!existing) {
        throw new Error('Operacion no encontrada.');
      }

      const existingQty = toNum(existing.quantity);
      const existingPrice = toNum(existing.priceLocal);
      const existingFee = toNum(existing.feeLocal);
      const existingGrossLocal = toNum(existing.grossLocal);
      const existingNetLocal = toNum(existing.netLocal);
      const existingNetEur = toNum(existing.netEur);
      const existingCostBasisLocal = toNum(existing.costBasisLocal);
      const existingCostBasisEur = toNum(existing.costBasisEur);
      const fxToEur = toNum(existing.fxToEur);

      if (existing.operationType === 'BUY') {
        await tx.asset.update({
          where: { id: existing.assetId },
          data: {
            quantity: round(toNum(existing.asset.quantity) - existingQty),
            investedCostLocal: round(toNum(existing.asset.investedCostLocal) - existingNetLocal),
            investedCostEur: round(toNum(existing.asset.investedCostEur) - existingNetEur),
            totalBoughtQty: round(toNum(existing.asset.totalBoughtQty) - existingQty),
            totalBoughtCostLocal: round(toNum(existing.asset.totalBoughtCostLocal) - existingNetLocal),
            totalBoughtCostEur: round(toNum(existing.asset.totalBoughtCostEur) - existingNetEur),
            marketPriceLocal: existingPrice,
            marketPriceEur: round(existingPrice * toNum(existing.fxToEur))
          }
        });
      } else {
        await tx.asset.update({
          where: { id: existing.assetId },
          data: {
            quantity: round(toNum(existing.asset.quantity) + existingQty),
            investedCostLocal: round(toNum(existing.asset.investedCostLocal) + existingCostBasisLocal),
            investedCostEur: round(toNum(existing.asset.investedCostEur) + existingCostBasisEur),
            totalSoldQty: round(toNum(existing.asset.totalSoldQty) - existingQty),
            totalSoldCostBasisLocal: round(toNum(existing.asset.totalSoldCostBasisLocal) - existingCostBasisLocal),
            totalSoldCostBasisEur: round(toNum(existing.asset.totalSoldCostBasisEur) - existingCostBasisEur),
            totalSoldProceedsLocal: round(toNum(existing.asset.totalSoldProceedsLocal) - existingNetLocal),
            totalSoldProceedsEur: round(toNum(existing.asset.totalSoldProceedsEur) - existingNetEur),
            marketPriceLocal: existingPrice,
            marketPriceEur: round(existingPrice * toNum(existing.fxToEur))
          }
        });
      }

      const asset = await tx.asset.findUnique({ where: { id: payload.assetId } });
      if (!asset) {
        throw new Error('Activo no encontrado.');
      }

      const quantity = Number(payload.quantity);
      const price = Number(payload.price);
      const fee = Number(payload.fee);
      const grossLocal = round(quantity * price);

      if (payload.type === 'buy') {
        const netLocal = round(grossLocal + fee);
        const netEur = round(netLocal * fxToEur);

        await tx.asset.update({
          where: { id: asset.id },
          data: {
            quantity: round(toNum(asset.quantity) + quantity),
            investedCostLocal: round(toNum(asset.investedCostLocal) + netLocal),
            investedCostEur: round(toNum(asset.investedCostEur) + netEur),
            totalBoughtQty: round(toNum(asset.totalBoughtQty) + quantity),
            totalBoughtCostLocal: round(toNum(asset.totalBoughtCostLocal) + netLocal),
            totalBoughtCostEur: round(toNum(asset.totalBoughtCostEur) + netEur),
            marketPriceLocal: price,
            marketPriceEur: round(price * fxToEur)
          }
        });

        await tx.assetOperation.update({
          where: { id: existing.id },
          data: {
            assetId: asset.id,
            operationType: 'BUY',
            occurredAt: new Date(payload.date),
            quantity,
            priceLocal: price,
            feeLocal: fee,
            fxToEur,
            grossLocal,
            grossEur: round(grossLocal * fxToEur),
            netLocal,
            netEur,
            costBasisLocal: 0,
            costBasisEur: 0,
            realizedPnlLocal: 0,
            realizedPnlEur: 0,
            note: payload.note?.trim() || null
          }
        });
      } else {
        const currentQty = toNum(asset.quantity);
        if (currentQty < quantity) {
          throw new Error('No hay suficiente cantidad para vender.');
        }

        const avgCostLocal = currentQty > 0 ? toNum(asset.investedCostLocal) / currentQty : 0;
        const avgCostEur = currentQty > 0 ? toNum(asset.investedCostEur) / currentQty : 0;
        const costBasisLocal = round(avgCostLocal * quantity);
        const costBasisEur = round(avgCostEur * quantity);
        const netLocal = round(grossLocal - fee);
        const netEur = round(netLocal * fxToEur);
        const realizedPnlLocal = round(netLocal - costBasisLocal);
        const realizedPnlEur = round(netEur - costBasisEur);

        await tx.asset.update({
          where: { id: asset.id },
          data: {
            quantity: round(currentQty - quantity),
            investedCostLocal: round(Math.max(0, toNum(asset.investedCostLocal) - costBasisLocal)),
            investedCostEur: round(Math.max(0, toNum(asset.investedCostEur) - costBasisEur)),
            totalSoldQty: round(toNum(asset.totalSoldQty) + quantity),
            totalSoldCostBasisLocal: round(toNum(asset.totalSoldCostBasisLocal) + costBasisLocal),
            totalSoldCostBasisEur: round(toNum(asset.totalSoldCostBasisEur) + costBasisEur),
            totalSoldProceedsLocal: round(toNum(asset.totalSoldProceedsLocal) + netLocal),
            totalSoldProceedsEur: round(toNum(asset.totalSoldProceedsEur) + netEur),
            marketPriceLocal: price,
            marketPriceEur: round(price * fxToEur)
          }
        });

        await tx.assetOperation.update({
          where: { id: existing.id },
          data: {
            assetId: asset.id,
            operationType: 'SELL',
            occurredAt: new Date(payload.date),
            quantity,
            priceLocal: price,
            feeLocal: fee,
            fxToEur,
            grossLocal,
            grossEur: round(grossLocal * fxToEur),
            netLocal,
            netEur,
            costBasisLocal,
            costBasisEur,
            realizedPnlLocal,
            realizedPnlEur,
            note: payload.note?.trim() || null
          }
        });
      }
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const dashboard = await getDashboardData(selectedBankId);
    res.status(200).json(dashboard);
  })
);

app.delete(
  '/api/operations/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const operationId = String(req.params.id);

    await prisma.$transaction(async (tx: any) => {
      const existing = await tx.assetOperation.findUnique({
        where: { id: operationId },
        include: { asset: true }
      });

      if (!existing) {
        throw new Error('Operacion no encontrada.');
      }

      const quantity = toNum(existing.quantity);
      const price = toNum(existing.priceLocal);
      const fee = toNum(existing.feeLocal);
      const grossLocal = toNum(existing.grossLocal);
      const netLocal = toNum(existing.netLocal);
      const netEur = toNum(existing.netEur);
      const costBasisLocal = toNum(existing.costBasisLocal);
      const costBasisEur = toNum(existing.costBasisEur);
      const fxToEur = toNum(existing.fxToEur);

      if (existing.operationType === 'BUY') {
        await tx.asset.update({
          where: { id: existing.assetId },
          data: {
            quantity: round(toNum(existing.asset.quantity) - quantity),
            investedCostLocal: round(toNum(existing.asset.investedCostLocal) - netLocal),
            investedCostEur: round(toNum(existing.asset.investedCostEur) - netEur),
            totalBoughtQty: round(toNum(existing.asset.totalBoughtQty) - quantity),
            totalBoughtCostLocal: round(toNum(existing.asset.totalBoughtCostLocal) - netLocal),
            totalBoughtCostEur: round(toNum(existing.asset.totalBoughtCostEur) - netEur),
            marketPriceLocal: price,
            marketPriceEur: round(price * fxToEur)
          }
        });
      } else {
        await tx.asset.update({
          where: { id: existing.assetId },
          data: {
            quantity: round(toNum(existing.asset.quantity) + quantity),
            investedCostLocal: round(toNum(existing.asset.investedCostLocal) + costBasisLocal),
            investedCostEur: round(toNum(existing.asset.investedCostEur) + costBasisEur),
            totalSoldQty: round(toNum(existing.asset.totalSoldQty) - quantity),
            totalSoldCostBasisLocal: round(toNum(existing.asset.totalSoldCostBasisLocal) - costBasisLocal),
            totalSoldCostBasisEur: round(toNum(existing.asset.totalSoldCostBasisEur) - costBasisEur),
            totalSoldProceedsLocal: round(toNum(existing.asset.totalSoldProceedsLocal) - netLocal),
            totalSoldProceedsEur: round(toNum(existing.asset.totalSoldProceedsEur) - netEur),
            marketPriceLocal: price,
            marketPriceEur: round(price * fxToEur)
          }
        });
      }

      await tx.assetOperation.delete({ where: { id: existing.id } });
    });

    const selectedBankId = String(req.query.bankId ?? ALL_BANKS);
    const dashboard = await getDashboardData(selectedBankId);
    res.status(200).json(dashboard);
  })
);

app.get(
  "/api/evolution",
  asyncHandler(async (req: Request, res: Response) => {
    const bankId = String(req.query.bankId ?? ALL_BANKS);
    const data = await getEvolutionPayload(bankId);
    res.json({
      items: data.monthlyItems,
      monthlyItems: data.monthlyItems,
      weeklyItems: data.weeklyItems,
      comparisons: data.comparisons
    });
  })
);

app.post(
  "/api/evolution/close-month",
  asyncHandler(async (req: Request, res: Response) => {
    const month = String(req.body?.month ?? "");
    await closeMonthEvolution(month);
    const bankId = String(req.query.bankId ?? ALL_BANKS);
    const data = await getEvolutionPayload(bankId);
    res.status(201).json({
      items: data.monthlyItems,
      monthlyItems: data.monthlyItems,
      weeklyItems: data.weeklyItems,
      comparisons: data.comparisons
    });
  })
);

app.post(
  "/api/evolution/close-week",
  asyncHandler(async (req: Request, res: Response) => {
    const week = String(req.body?.week ?? "");
    await closeWeekEvolution(week);
    const bankId = String(req.query.bankId ?? ALL_BANKS);
    const data = await getEvolutionPayload(bankId);
    res.status(201).json({
      items: data.monthlyItems,
      monthlyItems: data.monthlyItems,
      weeklyItems: data.weeklyItems,
      comparisons: data.comparisons
    });
  })
);

app.post(
  "/api/fx-rate",
  asyncHandler(async (req: Request, res: Response) => {
    const manualRate = req.body?.rate ? Number(req.body.rate) : null;
    const date = new Date();

    let rate = manualRate;

    if (rate === null) {
      // Obtain automatically from Yahoo Finance
      try {
        rate = await fetchYahooFxRate("EURUSD");
      } catch (error) {
        res.status(400).json({
          message: `No se pudo obtener el rate EUR/USD desde Yahoo Finance (EURUSD). Intenta ingresar manualmente.`
        });
        return;
      }
    }

    if (rate === null || rate <= 0 || Number.isNaN(rate)) {
      res.status(400).json({ message: "El rate EUR/USD debe ser un número positivo." });
      return;
    }

    await prisma.fxRate.upsert({
      where: {
        date_fromCurrency_toCurrency: {
          date: date,
          fromCurrency: "EUR",
          toCurrency: "USD"
        }
      },
      update: { rate: parseFloat(rate.toFixed(6)) },
      create: {
        date,
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: parseFloat(rate.toFixed(6))
      }
    });

    const currentRate = await prisma.fxRate.findFirst({
      where: {
        fromCurrency: "EUR",
        toCurrency: "USD"
      },
      orderBy: { date: "desc" }
    });

    res.status(201).json({
      message: "Rate EUR/USD actualizado",
      rate: currentRate?.rate,
      date: currentRate?.date
    });
  })
);

app.get(
  "/api/fx-rate",
  asyncHandler(async (req: Request, res: Response) => {
    const currentRate = await prisma.fxRate.findFirst({
      where: {
        fromCurrency: "EUR",
        toCurrency: "USD"
      },
      orderBy: { date: "desc" }
    });

    if (!currentRate) {
      res.status(404).json({ rate: null, date: null });
      return;
    }

    res.json({
      rate: currentRate.rate,
      date: currentRate.date
    });
  })
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const message = err.message || "Error interno del servidor";
  const status = message.includes("No se") || message.includes("no cubre") ? 400 : 500;
  res.status(status).json({ message });
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Backend listo en puerto ${port}`);
});

// Bulk update market config
app.put('/assets/bulk-market-config', async (req, res) => {
  const { updates, bankId } = req.body as {
    updates: Array<{ id: string; marketSymbol: string; marketProvider: ApiMarketProvider }>;
    bankId: string;
  };

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ message: 'Invalid updates array' });
  }

  try {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.asset.update({
          where: { id: u.id },
          data: {
            marketSymbol: u.marketSymbol,
            marketProvider: mapMarketProviderFromApi(u.marketProvider)
          }
        })
      )
    );

    const dashboard = await getDashboardData(bankId);
    res.json(dashboard);
  } catch (error) {
    console.error('Failed to bulk update market config:', error);
    res.status(500).json({ message: 'Failed to bulk update market config' });
  }
});
