import { Component, Injectable, inject, signal } from '@angular/core';

type Ask = { title: string; message: string; ok: string; danger: boolean; resolve: (yes: boolean) => void };

/**
 * In-app confirmation instead of the browser's confirm(): `await confirm.ask('¿Borrar…?')` → true / false.
 * The dialog itself (<app-confirm-dialog>) lives once in the app shell.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<Ask | null>(null);

  /** Deletions ("Borrar…", "Eliminar…") get a red button with that verb unless `ok` says otherwise. */
  ask(message: string, options: { title?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
    const verb = /^¿?(Borrar|Eliminar)/i.exec(message)?.[1];
    return new Promise((resolve) => {
      this.current()?.resolve(false);
      this.current.set({
        title: options.title ?? (verb ? `${verb[0].toUpperCase()}${verb.slice(1).toLowerCase()}` : 'Confirmar'),
        message,
        ok: options.ok ?? (verb ? `${verb[0].toUpperCase()}${verb.slice(1).toLowerCase()}` : 'Aceptar'),
        danger: options.danger ?? !!verb,
        resolve,
      });
    });
  }

  answer(yes: boolean): void {
    const c = this.current();
    this.current.set(null);
    c?.resolve(yes);
  }
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  host: { '(document:keydown.escape)': 'confirm.current() && confirm.answer(false)' },
  template: `
    @if (confirm.current(); as c) {
      <div class="dialog-backdrop" (click)="confirm.answer(false)">
        <div class="dialog" role="alertdialog" aria-modal="true" (click)="$event.stopPropagation()">
          <div class="dialog-head"><h2>{{ c.title }}</h2></div>
          <p class="msg">{{ c.message }}</p>
          <div class="dialog-foot">
            <button type="button" class="btn" (click)="confirm.answer(false)">Cancelar</button>
            <button type="button" class="btn primary" [class.danger-fill]="c.danger" (click)="confirm.answer(true)" #ok>{{ c.ok }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .msg { margin: 0; color: var(--text-2); line-height: 1.5; font-size: 14px; }
    .danger-fill { background: var(--down); border-color: var(--down); color: #fff; }
    .danger-fill:hover { background: var(--down); opacity: 0.9; }
  `
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(ConfirmService);
}
