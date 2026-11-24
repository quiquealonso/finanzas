-- CreateEnum
CREATE TYPE "BettingTransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "betting_houses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "betting_houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "betting_transactions" (
    "id" TEXT NOT NULL,
    "bettingHouseId" TEXT NOT NULL,
    "type" "BettingTransactionType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "betting_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "betting_houses_name_key" ON "betting_houses"("name");

-- CreateIndex
CREATE INDEX "betting_transactions_bettingHouseId_idx" ON "betting_transactions"("bettingHouseId");

-- CreateIndex
CREATE INDEX "betting_transactions_date_idx" ON "betting_transactions"("date");

-- AddForeignKey
ALTER TABLE "betting_transactions" ADD CONSTRAINT "betting_transactions_bettingHouseId_fkey" FOREIGN KEY ("bettingHouseId") REFERENCES "betting_houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
