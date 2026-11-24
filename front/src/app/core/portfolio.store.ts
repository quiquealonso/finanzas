import { Injectable, computed, inject, signal } from '@angular/core';
import { PortfolioApi, errorMessage } from './portfolio-api.service';
import { MovementKind, Overview } from './portfolio.models';

export type Toast = { id: number; kind: 'ok' | 'error'; text: string };
export type MovementPreset = { kind?: MovementKind; assetId?: string };

// Shared state for every page: the portfolio overview, the movement dialog and toasts.
@Injectable({ providedIn: 'root' })
export class PortfolioStore {
  private readonly api = inject(PortfolioApi);

  readonly overview = signal<Overview | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly toasts = signal<Toast[]>([]);
  readonly movementDialog = signal<MovementPreset | null>(null);
  /** Bumped after any change, so pages with their own data reload. */
  readonly version = signal(0);

  readonly assets = computed(() => this.overview()?.assets ?? []);
  readonly banks = computed(() => this.overview()?.banks ?? []);
  readonly types = computed(() => this.overview()?.types ?? []);

  private toastId = 0;

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.overview.set(await this.api.overview());
      this.loadError.set(null);
    } catch (error) {
      this.loadError.set(errorMessage(error, 'No se pudieron cargar los datos.'));
    } finally {
      this.loading.set(false);
    }
  }

  async changed(message?: string): Promise<void> {
    if (message) this.toast('ok', message);
    this.version.update((v) => v + 1);
    await this.refresh();
  }

  openMovement(preset: MovementPreset = {}): void {
    this.movementDialog.set(preset);
  }

  closeMovement(): void {
    this.movementDialog.set(null);
  }

  toast(kind: Toast['kind'], text: string): void {
    const id = ++this.toastId;
    this.toasts.update((list) => [...list, { id, kind, text }]);
    setTimeout(() => this.toasts.update((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3000);
  }

  error(error: unknown, fallback?: string): void {
    this.toast('error', errorMessage(error, fallback));
  }
}
