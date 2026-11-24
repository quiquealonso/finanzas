import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { enterAs } from '../../core/session';

const API = 'http://localhost:3000';

type User = { id: string; name: string; hasPassword: boolean };

/**
 * Entry screen: pick a user and type the password. POST /api/auth/login returns a session token (12 h) that the
 * interceptor sends on every request (core/session.ts). Passwords are set on the server: `npm run set-password`.
 */
@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <div class="card box">
        <div class="brand">Finanzas</div>

        @if (!chosen()) {
          <p class="muted">¿Quién eres?</p>
          @if (error()) { <div class="notice">{{ error() }}</div> }
          <div class="users">
            @for (u of users(); track u.id) {
              <button type="button" class="user" (click)="choose(u)">
                <span class="avatar">{{ initials(u.name) }}</span>
                <span>{{ u.name }}</span>
                <span class="go">›</span>
              </button>
            } @empty {
              @if (!error()) { <p class="faint small">Cargando…</p> }
            }
          </div>
        } @else {
          @let u = chosen()!;
          <button type="button" class="back btn sm link" (click)="chosen.set(null)">‹ Otro usuario</button>
          <div class="who">
            <span class="avatar big">{{ initials(u.name) }}</span>
            <strong>{{ u.name }}</strong>
          </div>
          @if (!u.hasPassword) {
            <div class="notice">
              Este usuario aún no tiene contraseña. Créala en el ordenador donde corre el back:
              <code>cd back; npm run set-password -- {{ u.id }}</code>
            </div>
          } @else {
            <form (ngSubmit)="login()" class="form">
              <label class="field">
                <span class="faint small">Contraseña</span>
                <input #pw type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required [disabled]="busy()" />
              </label>
              @if (error()) { <div class="notice">{{ error() }}</div> }
              <button type="submit" class="btn primary" [disabled]="busy() || !password">{{ busy() ? 'Entrando…' : 'Entrar' }}</button>
            </form>
          }
        }
      </div>
    </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--bg); }
    .box { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 14px; padding: 28px; text-align: center; }
    .brand { font-weight: 600; font-size: 22px; letter-spacing: -0.01em; }
    .users { display: flex; flex-direction: column; gap: 10px; }
    .user {
      display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--radius);
      border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer;
      font: inherit; font-size: 15px; text-align: left;
    }
    .user:hover { border-color: var(--accent); background: var(--surface-hover); }
    .go { margin-left: auto; color: var(--text-3); font-size: 18px; }
    .avatar {
      width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      background: var(--accent-soft); color: var(--accent-text); font-weight: 600; font-size: 13px; flex: none;
    }
    .avatar.big { width: 52px; height: 52px; font-size: 18px; }
    .back { align-self: flex-start; }
    .who { display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 16px; }
    .form { display: flex; flex-direction: column; gap: 12px; text-align: left; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field input { height: 40px; font-size: 15px; }
    .form .btn { height: 40px; }
    .notice { text-align: left; }
    code { display: block; margin-top: 6px; font-family: var(--mono); font-size: 12px; user-select: all; }
  `
})
export class LoginPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly users = signal<User[]>([]);
  protected readonly chosen = signal<User | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected password = '';
  private readonly pw = viewChild<ElementRef<HTMLInputElement>>('pw');

  async ngOnInit(): Promise<void> {
    try {
      const r = await firstValueFrom(this.http.get<{ users: User[] }>(`${API}/api/v2/users`));
      this.users.set(r.users);
    } catch {
      this.error.set('No se pudo conectar con el servidor. ¿Está arrancado el back?');
    }
  }

  protected choose(u: User): void {
    this.chosen.set(u);
    this.password = '';
    this.error.set('');
    setTimeout(() => this.pw()?.nativeElement.focus());
  }

  protected async login(): Promise<void> {
    const u = this.chosen();
    if (!u || !this.password || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.http.post<{ token: string }>(`${API}/api/auth/login`, { user: u.id, password: this.password }));
      this.password = '';
      enterAs(r.token);
    } catch (e) {
      const msg = e instanceof HttpErrorResponse ? e.error?.error : null;
      this.error.set(msg || 'No se pudo entrar.');
      this.busy.set(false);
      this.password = '';
      setTimeout(() => this.pw()?.nativeElement.focus());
    }
  }

  protected initials(name: string): string {
    return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }
}
