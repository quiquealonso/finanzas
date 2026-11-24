import { Component, OnInit, input, model } from '@angular/core';

export type ListView = 'cards' | 'table';

/**
 * "Tarjetas / Tabla" switch. Remembers the choice of each page in the browser (storageKey); cards by default.
 */
@Component({
  selector: 'app-view-toggle',
  standalone: true,
  template: `
    <span class="lbl">Ver</span>
    <div class="seg small-seg">
      <button type="button" [class.on]="view() === 'cards'" (click)="pick('cards')">Tarjetas</button>
      <button type="button" [class.on]="view() === 'table'" (click)="pick('table')">Tabla</button>
    </div>
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 8px; }
    .lbl { font-size: 12px; color: var(--text-3); }
    .small-seg button { font-size: 12px; padding: 0 9px; }
  `
})
export class ViewToggleComponent implements OnInit {
  readonly view = model<ListView>('cards');
  /** localStorage key, e.g. "movements.view". */
  readonly storageKey = input.required<string>();

  ngOnInit(): void {
    try {
      const saved = localStorage.getItem(this.storageKey());
      if (saved === 'cards' || saved === 'table') this.view.set(saved);
    } catch {
      /* private mode or blocked storage: keep the default */
    }
  }

  protected pick(v: ListView): void {
    this.view.set(v);
    try {
      localStorage.setItem(this.storageKey(), v);
    } catch {
      /* not remembered, still switches */
    }
  }
}
