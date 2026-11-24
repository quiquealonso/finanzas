-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "quantity" DECIMAL NOT NULL DEFAULT 0,
    "investedCostLocal" DECIMAL NOT NULL DEFAULT 0,
    "investedCostEur" DECIMAL NOT NULL DEFAULT 0,
    "marketPriceLocal" DECIMAL NOT NULL DEFAULT 0,
    "marketPriceEur" DECIMAL NOT NULL DEFAULT 0,
    "totalBoughtQty" DECIMAL NOT NULL DEFAULT 0,
    "totalBoughtCostLocal" DECIMAL NOT NULL DEFAULT 0,
    "totalBoughtCostEur" DECIMAL NOT NULL DEFAULT 0,
    "totalSoldQty" DECIMAL NOT NULL DEFAULT 0,
    "totalSoldProceedsLocal" DECIMAL NOT NULL DEFAULT 0,
    "totalSoldProceedsEur" DECIMAL NOT NULL DEFAULT 0,
    "totalSoldCostBasisLocal" DECIMAL NOT NULL DEFAULT 0,
    "totalSoldCostBasisEur" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "assets_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurredAt" DATETIME NOT NULL,
    "note" TEXT,
    "sourceAssetId" TEXT NOT NULL,
    "sourceCurrency" TEXT NOT NULL,
    "soldQuantity" DECIMAL NOT NULL,
    "sellPriceLocal" DECIMAL NOT NULL,
    "sellFeeLocal" DECIMAL NOT NULL DEFAULT 0,
    "sourceFxToEur" DECIMAL NOT NULL,
    "soldCostBasisLocal" DECIMAL NOT NULL,
    "soldCostBasisEur" DECIMAL NOT NULL,
    "soldNetLocal" DECIMAL NOT NULL,
    "soldNetEur" DECIMAL NOT NULL,
    "realizedPnlLocal" DECIMAL NOT NULL,
    "realizedPnlEur" DECIMAL NOT NULL,
    "targetAssetId" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "buyPriceLocal" DECIMAL NOT NULL,
    "buyFeeLocal" DECIMAL NOT NULL DEFAULT 0,
    "targetFxToEur" DECIMAL NOT NULL,
    "boughtQuantity" DECIMAL NOT NULL,
    "buyCostLocal" DECIMAL NOT NULL,
    "buyCostEur" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transfers_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transfers_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "provider" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "monthly_portfolio_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankId" TEXT,
    "month" DATETIME NOT NULL,
    "positionValueEur" DECIMAL NOT NULL,
    "positionCostEur" DECIMAL NOT NULL,
    "realizedPnlEur" DECIMAL NOT NULL,
    "unrealizedPnlEur" DECIMAL NOT NULL,
    "totalPnlEur" DECIMAL NOT NULL,
    "profitability" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "monthly_portfolio_snapshots_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "banks_name_key" ON "banks"("name");

-- CreateIndex
CREATE INDEX "assets_bankId_idx" ON "assets"("bankId");

-- CreateIndex
CREATE INDEX "assets_currency_idx" ON "assets"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "assets_bankId_name_key" ON "assets"("bankId", "name");

-- CreateIndex
CREATE INDEX "transfers_occurredAt_idx" ON "transfers"("occurredAt");

-- CreateIndex
CREATE INDEX "transfers_sourceAssetId_idx" ON "transfers"("sourceAssetId");

-- CreateIndex
CREATE INDEX "transfers_targetAssetId_idx" ON "transfers"("targetAssetId");

-- CreateIndex
CREATE INDEX "fx_rates_fromCurrency_toCurrency_date_idx" ON "fx_rates"("fromCurrency", "toCurrency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_date_fromCurrency_toCurrency_key" ON "fx_rates"("date", "fromCurrency", "toCurrency");

-- CreateIndex
CREATE INDEX "monthly_portfolio_snapshots_month_idx" ON "monthly_portfolio_snapshots"("month");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_portfolio_snapshots_bankId_month_key" ON "monthly_portfolio_snapshots"("bankId", "month");
