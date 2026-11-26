import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AllocationTarget, BankingBank, BankingStatus, BankTx, BenchmarkData, CalendarDay, CalendarDayDetail, ClosingSheet, Goal, GoalsData, IntradayData, MagicFormulaData, MonthlyData, Movement, NewsData, PerpsData, WalletsData, Overview, PriceQuote, RealEstateTicket, RealizedData, RecurringData } from './portfolio.models';

const BASE = 'http://localhost:3000/api';

@Injectable({ providedIn: 'root' })
export class PortfolioApi {
  private readonly http = inject(HttpClient);

  overview(): Promise<Overview> {
    return firstValueFrom(this.http.get<Overview>(`${BASE}/v2/overview`));
  }

  monthly(): Promise<MonthlyData> {
    return firstValueFrom(this.http.get<MonthlyData>(`${BASE}/v2/monthly`));
  }

  movements(limit = 500): Promise<Movement[]> {
    return firstValueFrom(this.http.get<Movement[]>(`${BASE}/v2/movements`, { params: { limit } }));
  }

  createMovement(body: Record<string, unknown>): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/movements`, body));
  }

  deleteMovement(groupId: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${BASE}/v2/movements/${groupId}`));
  }

  price(assetId: string, date: string): Promise<PriceQuote> {
    return firstValueFrom(this.http.get<PriceQuote>(`${BASE}/v2/assets/${assetId}/price`, { params: { date } }));
  }

  createAsset(body: Record<string, unknown>): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`${BASE}/v2/assets`, body));
  }

  updateAsset(id: string, body: Record<string, unknown>): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${BASE}/v2/assets/${id}`, body));
  }

  deleteAsset(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${BASE}/v2/assets/${id}`));
  }

  createBank(name: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/banks`, { name }));
  }

  renameBank(id: string, name: string): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${BASE}/banks/${id}`, { name }));
  }

  recurring(): Promise<RecurringData> {
    return firstValueFrom(this.http.get<RecurringData>(`${BASE}/v2/recurring`));
  }

  createRecurring(body: Record<string, unknown>): Promise<RecurringData> {
    return firstValueFrom(this.http.post<RecurringData>(`${BASE}/v2/recurring`, body));
  }

  updateRecurring(id: string, body: Record<string, unknown>): Promise<RecurringData> {
    return firstValueFrom(this.http.patch<RecurringData>(`${BASE}/v2/recurring/${id}`, body));
  }

  deleteRecurring(id: string): Promise<RecurringData> {
    return firstValueFrom(this.http.delete<RecurringData>(`${BASE}/v2/recurring/${id}`));
  }

  skipRecurring(id: string, period: string): Promise<RecurringData> {
    return firstValueFrom(this.http.post<RecurringData>(`${BASE}/v2/recurring/${id}/skip`, { period }));
  }

  registerRecurring(id: string, body: Record<string, unknown>): Promise<RecurringData> {
    return firstValueFrom(this.http.post<RecurringData>(`${BASE}/v2/recurring/${id}/register`, body));
  }

  realized(): Promise<RealizedData> {
    return firstValueFrom(this.http.get<RealizedData>(`${BASE}/v2/realized`));
  }

  createClosedPosition(body: Record<string, unknown>): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`${BASE}/v2/closed-positions`, body));
  }

  realEstate(): Promise<RealEstateTicket[]> {
    return firstValueFrom(this.http.get<RealEstateTicket[]>(`${BASE}/v2/real-estate`));
  }

  createTicket(body: Record<string, unknown>): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>(`${BASE}/v2/real-estate`, body));
  }

  updateTicket(id: string, body: Record<string, unknown>): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${BASE}/v2/real-estate/${id}`, body));
  }

  collectTicket(id: string, body: Record<string, unknown>): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/real-estate/${id}/collect`, body));
  }

  intraday(): Promise<IntradayData> {
    return firstValueFrom(this.http.get<IntradayData>(`${BASE}/v2/intraday`));
  }

  closings(year?: number): Promise<ClosingSheet> {
    const params: Record<string, string> = year ? { year: String(year) } : {};
    return firstValueFrom(this.http.get<ClosingSheet>(`${BASE}/v2/closings`, { params }));
  }

  closeMonth(year: number, month: number): Promise<{ assets: number; monthEnd: string }> {
    return firstValueFrom(this.http.post<{ assets: number; monthEnd: string }>(`${BASE}/v2/closings/close`, { year, month }));
  }

  createClosingSection(body: { year: number; name: string; inTotal: boolean }): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/closings/sections`, body));
  }

  updateClosingSection(id: string, body: { name?: string; inTotal?: boolean; move?: number }): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${BASE}/v2/closings/sections/${id}`, body));
  }

  deleteClosingSection(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${BASE}/v2/closings/sections/${id}`));
  }

  createClosingRow(body: { sectionId: string; name: string }): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/closings/rows`, body));
  }

  updateClosingRow(id: string, body: { name?: string; move?: number; cell?: string; value?: string }): Promise<unknown> {
    return firstValueFrom(this.http.patch(`${BASE}/v2/closings/rows/${id}`, body));
  }

  deleteClosingRow(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${BASE}/v2/closings/rows/${id}`));
  }

  syncPrices(): Promise<{ assetsOk: number; assetsFailed: number; errors: string | null }> {
    return firstValueFrom(this.http.post<{ assetsOk: number; assetsFailed: number; errors: string | null }>(`${BASE}/v2/prices/sync`, {}));
  }

  goals(): Promise<GoalsData> {
    return firstValueFrom(this.http.get<GoalsData>(`${BASE}/v2/goals`));
  }

  createGoal(body: { name: string; targetEur: number; targetDate: string; monthlyEur: number | null }): Promise<Goal> {
    return firstValueFrom(this.http.post<Goal>(`${BASE}/v2/goals`, body));
  }

  updateGoal(id: string, body: Partial<{ name: string; targetEur: number; targetDate: string; monthlyEur: number | null }>): Promise<Goal> {
    return firstValueFrom(this.http.patch<Goal>(`${BASE}/v2/goals/${id}`, body));
  }

  deleteGoal(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`${BASE}/v2/goals/${id}`));
  }

  allocationTargets(): Promise<AllocationTarget[]> {
    return firstValueFrom(this.http.get<AllocationTarget[]>(`${BASE}/v2/allocation-targets`));
  }

  saveAllocationTargets(rows: AllocationTarget[]): Promise<unknown> {
    return firstValueFrom(this.http.put(`${BASE}/v2/allocation-targets`, { rows }));
  }

  news(days = 60): Promise<NewsData> {
    return firstValueFrom(this.http.get<NewsData>(`${BASE}/v2/news`, { params: { days } }));
  }

  /** Daily series (like the overview one) of the assets of some banks and/or types; empty lists = any. */
  async series(banks: string[], types: string[]): Promise<Overview['series']> {
    const q = new URLSearchParams({ banks: banks.join(','), types: types.join(',') });
    return (await firstValueFrom(this.http.get<{ series: Overview['series'] }>(`${BASE}/v2/series?${q}`))).series;
  }

  // ---- Gastos (Open Banking, back/src/banking.ts)
  bankingStatus(): Promise<BankingStatus> {
    return firstValueFrom(this.http.get<BankingStatus>(`${BASE}/v2/banking/status`));
  }
  bankingBanks(country: string): Promise<{ banks: BankingBank[] }> {
    return firstValueFrom(this.http.get<{ banks: BankingBank[] }>(`${BASE}/v2/banking/banks`, { params: { country } }));
  }
  bankingConnect(aspsp: string, country: string): Promise<{ url: string; days: number }> {
    return firstValueFrom(this.http.post<{ url: string; days: number }>(`${BASE}/v2/banking/connect`, { aspsp, country }));
  }
  bankingSync(): Promise<{ added: number; accounts: number; errors: string[] }> {
    return firstValueFrom(this.http.post<{ added: number; accounts: number; errors: string[] }>(`${BASE}/v2/banking/sync`, {}));
  }
  /** A bank statement in PDF (Trade Republic): fills the history before what Open Banking gives. */
  bankingStatement(pdf: Blob): Promise<{ bank: string; read: number; imported: number; skipped: number; until: string | null; from: string | null; to: string | null; checked: boolean }> {
    return firstValueFrom(this.http.post<any>(`${BASE}/v2/banking/statement`, pdf, { headers: { 'Content-Type': 'application/pdf' } }));
  }
  bankingRevoke(linkId: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/banking/links/${linkId}/revoke`, {}));
  }
  bankingTransactions(from: string): Promise<{ transactions: BankTx[] }> {
    return firstValueFrom(this.http.get<{ transactions: BankTx[] }>(`${BASE}/v2/banking/transactions`, { params: { from } }));
  }
  bankingSetCategory(id: string, category: string, learn?: string): Promise<{ ok: boolean; applied: number }> {
    return firstValueFrom(this.http.patch<{ ok: boolean; applied: number }>(`${BASE}/v2/banking/transactions/${id}`, { category, learn }));
  }

  /** Daily closes in euros of the indexes of the page Comparar, from a day on (back/src/benchmarks.ts). */
  benchmarks(from: string): Promise<{ benchmarks: BenchmarkData[]; failed: string[] }> {
    return firstValueFrom(this.http.get<{ benchmarks: BenchmarkData[]; failed: string[] }>(`${BASE}/v2/benchmarks`, { params: { from } }));
  }

  calendar(): Promise<{ days: CalendarDay[] }> {
    return firstValueFrom(this.http.get<{ days: CalendarDay[] }>(`${BASE}/v2/calendar`));
  }

  calendarDay(date: string): Promise<CalendarDayDetail> {
    return firstValueFrom(this.http.get<CalendarDayDetail>(`${BASE}/v2/calendar/${date}`));
  }

  magicFormula(run?: string): Promise<MagicFormulaData> {
    return firstValueFrom(this.http.get<MagicFormulaData>(`${BASE}/v2/magic-formula`, { params: run ? { run } : {} }));
  }

  perps(): Promise<PerpsData> {
    return firstValueFrom(this.http.get<PerpsData>(`${BASE}/v2/perps`));
  }

  syncHyperliquid(): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/hyperliquid/sync`, {}));
  }

  wallets(): Promise<WalletsData> {
    return firstValueFrom(this.http.get<WalletsData>(`${BASE}/v2/wallets`));
  }

  syncWallets(): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/wallets/sync`, {}));
  }

  applyWalletDiff(chain: string, token: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/wallets/apply`, { chain, token }));
  }

  mapWalletToken(body: { chain: string; token: string; assetId?: string; name?: string; symbol?: string; ignore?: boolean }): Promise<unknown> {
    return firstValueFrom(this.http.post(`${BASE}/v2/wallets/map`, body));
  }
}

export function errorMessage(error: unknown, fallback = 'Algo ha fallado.'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'No hay conexion con el backend (puerto 3000).';
    return error.error?.message ?? fallback;
  }
  return fallback;
}
