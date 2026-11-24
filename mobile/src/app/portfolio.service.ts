import { Injectable, signal } from '@angular/core';
import { createClient, Session } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase.config';

export type Range = '1D' | '1S' | '1M' | 'YTD';

export interface Summary {
  asOf: string;
  lastCloseDay: string | null;
  totalEur: number;
  dayChangeEur: number;
  dayChangePct: number;
  pnlEur: number;
  pnlPct: number;
  pendingEur: number;
  updatedAt: string | null;
}

export interface SeriesPoint {
  /** Day (YYYY-MM-DD) or timestamp of an hourly point. */
  t: string;
  value: number;
  cost: number;
  realized: number;
  /** First point of the 1D chart: the previous close. */
  close?: boolean;
}

// Read-only access to the portfolio through the RPC functions of back/supabase/mobile.sql.
@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private readonly client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  readonly session = signal<Session | null>(null);
  readonly ready = signal(false);

  constructor() {
    void this.client.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      this.ready.set(true);
    });
    this.client.auth.onAuthStateChange((_event, session) => this.session.set(session));
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos.' : error.message);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async summary(): Promise<Summary> {
    const { data, error } = await this.client.rpc('mobile_summary');
    if (error) throw new Error(error.message);
    return data as Summary;
  }

  async series(range: Range): Promise<SeriesPoint[]> {
    const { data, error } = await this.client.rpc('mobile_series', { p_range: range });
    if (error) throw new Error(error.message);
    return (data as { points: SeriesPoint[] }).points;
  }
}
