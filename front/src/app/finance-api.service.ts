import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BettingDashboardData,
  BettingTransactionType,
  BettingHouseSummary,
  DashboardData,
  EvolutionPayload,
  EvolutionPoint,
  PriceSyncResult,
  StandaloneOperationDraft,
  TransferDraft
} from './models/finance.models';

@Injectable({ providedIn: 'root' })
export class FinanceApiService {
  private readonly baseUrl = 'http://localhost:3000/api';

  constructor(private readonly http: HttpClient) {}

  getDashboard(bankId: string): Observable<DashboardData> {
    return this.http.get<DashboardData>(`${this.baseUrl}/dashboard`, {
      params: { bankId }
    });
  }

  createBank(name: string): Observable<DashboardData> {
    return this.http.post<DashboardData>(`${this.baseUrl}/banks`, { name });
  }

  updateBank(id: string, name: string, bankId: string): Observable<DashboardData> {
    return this.http.patch<DashboardData>(
      `${this.baseUrl}/banks/${id}`,
      { name },
      { params: { bankId } }
    );
  }

  createAsset(payload: {
    bankId: string;
    name: string;
    type: string;
    currency: 'EUR' | 'USD';
    marketSymbol: string;
    marketProvider: 'stooq' | 'alphavantage' | 'yahoo';
    quantity: number;
    avgBuyPrice: number;
    marketPrice: number;
  }): Observable<DashboardData> {
    return this.http.post<DashboardData>(`${this.baseUrl}/assets`, payload);
  }

  updateAssetPrice(assetId: string, marketPrice: number, bankId: string): Observable<DashboardData> {
    return this.http.put<DashboardData>(`${this.baseUrl}/assets/${assetId}/price`, { marketPrice, bankId });
  }

  bulkUpdateMarketConfig(
    updates: Array<{ id: string; marketSymbol: string; marketProvider: 'stooq' | 'alphavantage' | 'yahoo' }>,
    bankId: string
  ): Observable<DashboardData> {
    return this.http.put<DashboardData>(`${this.baseUrl}/assets/bulk-market-config`, { updates, bankId });
  }

  updateAssetDetails(
    assetId: string,
    payload: {
      name: string;
      avgBuyPrice: number;
      marketPrice: number;
      marketSymbol: string;
      marketProvider: 'stooq' | 'alphavantage' | 'yahoo';
    },
    bankId: string
  ): Observable<DashboardData> {
    return this.http.patch<DashboardData>(`${this.baseUrl}/assets/${assetId}`, payload, {
      params: { bankId }
    });
  }

  updateAssetMarketConfig(
    assetId: string,
    marketSymbol: string,
    marketProvider: 'stooq' | 'alphavantage' | 'yahoo',
    bankId: string
  ): Observable<DashboardData> {
    return this.http.patch<DashboardData>(
      `${this.baseUrl}/assets/${assetId}/market-config`,
      { marketSymbol, marketProvider },
      { params: { bankId } }
    );
  }

  syncMonthPrices(
    month: string,
    bankId: string
  ): Observable<{ sync: PriceSyncResult; dashboard: DashboardData }> {
    return this.http.post<{ sync: PriceSyncResult; dashboard: DashboardData }>(
      `${this.baseUrl}/prices/sync-month`,
      { month },
      { params: { bankId } }
    );
  }

  createTransfer(draft: TransferDraft, bankId: string): Observable<DashboardData> {
    return this.http.post<DashboardData>(`${this.baseUrl}/transfers`, { ...draft, bankId });
  }

  updateTransfer(id: string, draft: TransferDraft, bankId: string): Observable<DashboardData> {
    return this.http.patch<DashboardData>(`${this.baseUrl}/transfers/${id}`, draft, {
      params: { bankId }
    });
  }

  deleteTransfer(id: string, bankId: string): Observable<DashboardData> {
    return this.http.delete<DashboardData>(`${this.baseUrl}/transfers/${id}`, {
      params: { bankId }
    });
  }

  createStandaloneOperation(draft: StandaloneOperationDraft, bankId: string): Observable<DashboardData> {
    return this.http.post<DashboardData>(`${this.baseUrl}/operations`, draft, {
      params: { bankId }
    });
  }

  updateStandaloneOperation(id: string, draft: StandaloneOperationDraft, bankId: string): Observable<DashboardData> {
    return this.http.patch<DashboardData>(`${this.baseUrl}/operations/${id}`, draft, {
      params: { bankId }
    });
  }

  deleteStandaloneOperation(id: string, bankId: string): Observable<DashboardData> {
    return this.http.delete<DashboardData>(`${this.baseUrl}/operations/${id}`, {
      params: { bankId }
    });
  }

  getEvolution(bankId: string): Observable<EvolutionPayload> {
    return this.http.get<EvolutionPayload>(`${this.baseUrl}/evolution`, {
      params: { bankId }
    });
  }

  closeMonthEvolution(month: string, bankId: string): Observable<EvolutionPayload> {
    return this.http.post<EvolutionPayload>(
      `${this.baseUrl}/evolution/close-month`,
      { month },
      { params: { bankId } }
    );
  }

  closeWeekEvolution(week: string, bankId: string): Observable<EvolutionPayload> {
    return this.http.post<EvolutionPayload>(
      `${this.baseUrl}/evolution/close-week`,
      { week },
      { params: { bankId } }
    );
  }

  getFxRate(): Observable<{ rate: number | null; date: string | null }> {
    return this.http.get<{ rate: number | null; date: string | null }>(`${this.baseUrl}/fx-rate`);
  }

  updateFxRate(rate?: number): Observable<{ message: string; rate: number; date: string }> {
    const payload = rate ? { rate } : {};
    return this.http.post<{ message: string; rate: number; date: string }>(`${this.baseUrl}/fx-rate`, payload);
  }

  getBettingDashboard(year: number): Observable<BettingDashboardData> {
    return this.http.get<BettingDashboardData>(`${this.baseUrl}/betting`, {
      params: { year }
    });
  }

  createBettingHouse(name: string, year: number): Observable<BettingHouseSummary> {
    return this.http.post<BettingHouseSummary>(`${this.baseUrl}/betting/houses`, { name }, {
      params: { year }
    });
  }

  deleteBettingHouse(id: string, year: number): Observable<BettingDashboardData> {
    return this.http.delete<BettingDashboardData>(`${this.baseUrl}/betting/houses/${id}`, {
      params: { year }
    });
  }

  createBettingTransaction(payload: {
    bettingHouseId: string;
    type: BettingTransactionType;
    amount: number;
    date: string;
    note: string;
  }, year: number): Observable<BettingDashboardData> {
    return this.http.post<BettingDashboardData>(`${this.baseUrl}/betting/transactions`, payload, {
      params: { year }
    });
  }

  deleteBettingTransaction(id: string, year: number): Observable<BettingDashboardData> {
    return this.http.delete<BettingDashboardData>(`${this.baseUrl}/betting/transactions/${id}`, {
      params: { year }
    });
  }
}
