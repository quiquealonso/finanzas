import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { demoState, isDemo, leaveDemo, setDemoState } from './demo-mode';
import { TOUR, TourStep } from './tour-steps';

/**
 * Guided tour of the demo (steps in tour-steps.ts). Starts by itself the first time the demo opens, remembers the
 * step on reload, and can be restarted from the sidebar. The page stays usable during the tour.
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly router = inject(Router);
  readonly steps = TOUR;
  readonly active = signal(false);
  readonly index = signal(0);
  readonly step = computed<TourStep>(() => this.steps[this.index()]);
  /** Chapters in order, for the progress line ("Tu perfil · 3 de 5"). */
  readonly chapterInfo = computed(() => {
    const ch = this.step().chapter;
    const same = this.steps.filter((s) => s.chapter === ch);
    return { chapter: ch, n: same.indexOf(this.step()) + 1, of: same.length, overall: this.index() + 1, total: this.steps.length };
  });

  /** Called once when the app starts. */
  init(): void {
    if (!isDemo()) return;
    const saved = demoState<{ index: number; done: boolean } | null>('tour', null);
    if (saved?.done) return;
    this.go(Math.min(saved?.index ?? 0, this.steps.length - 1));
  }

  restart(): void {
    this.go(0);
  }

  next(): void {
    if (this.index() < this.steps.length - 1) this.go(this.index() + 1);
    else this.finish();
  }

  back(): void {
    if (this.index() > 0) this.go(this.index() - 1);
  }

  /** Button of a step: "next", "end", "leave", "restart" or the id of a step. */
  action(goto: string): void {
    if (goto === 'next') return this.next();
    if (goto === 'end') return this.finish();
    if (goto === 'leave') return leaveDemo();
    if (goto === 'restart') return this.restart();
    const i = this.steps.findIndex((s) => s.id === goto);
    if (i >= 0) this.go(i);
  }

  finish(): void {
    this.active.set(false);
    setDemoState('tour', { index: this.index(), done: true });
  }

  private go(i: number): void {
    this.index.set(i);
    this.active.set(true);
    setDemoState('tour', { index: i, done: false });
    const route = this.steps[i].route;
    if (route && this.router.url.split(/[?#]/)[0] !== route) void this.router.navigateByUrl(route);
  }
}
