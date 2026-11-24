import { Component, computed, ElementRef, inject, input, model, signal } from '@angular/core';

export type MultiOption = { id: string; label: string; color?: string; hint?: string };

/**
 * Dropdown with checkboxes: several options can be picked, none = all ("Todos").
 * The button shows "Todos", the one picked, or how many.
 */
@Component({
  selector: 'app-multi-select',
  standalone: true,
  host: { '(document:click)': 'outside($event)', '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <button type="button" class="ms-btn" [class.active]="selected().length" (click)="open.set(!open())" [attr.aria-expanded]="open()">
      <span class="ms-label">{{ label() }}</span>
      <span class="ms-value">{{ summary() }}</span>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
    </button>
    @if (open()) {
      <div class="ms-pop" role="listbox" aria-multiselectable="true">
        <label class="ms-opt all">
          <input type="checkbox" [checked]="!selected().length" (change)="selected.set([])" />
          <span>Todos</span>
        </label>
        @for (o of options(); track o.id) {
          <label class="ms-opt">
            <input type="checkbox" [checked]="selected().includes(o.id)" (change)="toggle(o.id)" />
            @if (o.color) { <span class="dot" [style.background]="o.color"></span> }
            <span class="ms-name">{{ o.label }}</span>
            @if (o.hint) { <span class="ms-hint">{{ o.hint }}</span> }
          </label>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; }
    .ms-btn {
      display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px 0 12px; min-width: 170px;
      border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); background: var(--surface); color: var(--text);
      font: inherit; font-size: 13px; cursor: pointer;
    }
    .ms-btn:hover { border-color: var(--border-strong); }
    .ms-btn.active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .ms-label { color: var(--text-3); font-size: 12px; }
    .ms-value { flex: 1; text-align: left; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
    .ms-pop {
      position: absolute; top: calc(100% + 4px); left: 0; z-index: 30; min-width: 100%; width: max-content; max-width: 320px;
      max-height: 340px; overflow-y: auto; padding: 6px; border: 1px solid var(--border); border-radius: 10px;
      background: var(--surface); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);
    }
    .ms-opt { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .ms-opt:hover { background: var(--surface-hover); }
    .ms-opt.all { border-bottom: 1px solid var(--border); border-radius: 6px 6px 0 0; margin-bottom: 2px; }
    .ms-name { flex: 1; }
    .ms-hint { color: var(--text-3); font-size: 11.5px; font-variant-numeric: tabular-nums; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  `
})
export class MultiSelectComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly label = input.required<string>();
  readonly options = input<MultiOption[]>([]);
  /** Picked option ids (empty = all). */
  readonly selected = model<string[]>([]);

  protected readonly open = signal(false);

  protected readonly summary = computed(() => {
    const sel = this.selected();
    if (!sel.length) return 'Todos';
    if (sel.length === 1) return this.options().find((o) => o.id === sel[0])?.label ?? '1 elegido';
    return `${sel.length} elegidos`;
  });

  protected toggle(id: string): void {
    this.selected.update((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  protected outside(e: Event): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
