import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { API_ORIGIN } from '../../core/api-origin';
import { enterAs } from '../../core/session';
import { enterDemo } from '../../demo/demo-mode';

/**
 * Entry screen: user name + password (POST /api/auth/login) returns a session token (12 h) that the interceptor
 * sends on every request (core/session.ts). The list of users is never shown. "Crear cuenta" only appears while the
 * back accepts registrations (REGISTER_CODE and REGISTER_MAX, back/src/auth.ts): it asks for the code the owner
 * gives in person, and the new account starts empty. The owner's users get their password with `npm run set-password`.
 */
@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <div class="card box">
        <div class="brand">Finanzas</div>

        @if (mode() === 'login') {
          <form (ngSubmit)="login()" class="form">
            <label class="field">
              <span class="faint small">Usuario</span>
              <input #first name="user" [(ngModel)]="user" autocomplete="username" autocapitalize="none" spellcheck="false" required [disabled]="busy()" />
            </label>
            <label class="field">
              <span class="faint small">Contraseña</span>
              <input #pw type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required [disabled]="busy()" />
            </label>
            @if (error()) { <div class="notice">{{ error() }}</div> }
            <button type="submit" class="btn primary" [disabled]="busy() || !user || !password">{{ busy() ? 'Entrando…' : 'Entrar' }}</button>
          </form>
          @if (registerOpen()) {
            <button type="button" class="btn sm link" (click)="switchTo('register')">¿No tienes cuenta? Crear una</button>
          }
          <div class="or"><span>¿Primera vez?</span></div>
          <button type="button" class="btn demo" (click)="demo()">✦ Probar la demo guiada</button>
          <p class="faint small">Una cartera de ejemplo y un tutorial paso a paso, empezando por tu perfil de inversor. Nada se guarda.</p>
        } @else {
          <button type="button" class="back btn sm link" (click)="switchTo('login')">‹ Ya tengo cuenta</button>
          <p class="muted">Crear cuenta</p>
          <form (ngSubmit)="register()" class="form">
            <label class="field">
              <span class="faint small">Código de registro</span>
              <input #first name="code" [(ngModel)]="code" autocomplete="off" spellcheck="false" required [disabled]="busy()" />
            </label>
            <label class="field">
              <span class="faint small">Tu nombre</span>
              <input name="name" [(ngModel)]="name" autocomplete="name" maxlength="40" required [disabled]="busy()" />
            </label>
            <label class="field">
              <span class="faint small">Usuario (para entrar)</span>
              <input name="user" [(ngModel)]="user" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" required [disabled]="busy()" />
            </label>
            <label class="field">
              <span class="faint small">Contraseña (mínimo 12 caracteres)</span>
              <input type="password" name="password" [(ngModel)]="password" autocomplete="new-password" minlength="12" required [disabled]="busy()" />
            </label>
            <label class="field">
              <span class="faint small">Repite la contraseña</span>
              <input type="password" name="password2" [(ngModel)]="password2" autocomplete="new-password" required [disabled]="busy()" />
            </label>
            @if (error()) { <div class="notice">{{ error() }}</div> }
            <button type="submit" class="btn primary" [disabled]="busy() || !code || !name || !user || !password">
              {{ busy() ? 'Creando…' : 'Crear cuenta' }}
            </button>
          </form>
          <p class="faint small">Tu cuenta empieza vacía: solo ves lo que tú añades.</p>
        }
      </div>
    </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--bg); }
    .box { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 14px; padding: 28px; text-align: center; }
    .brand { font-weight: 600; font-size: 22px; letter-spacing: -0.01em; }
    .back { align-self: flex-start; }
    .form { display: flex; flex-direction: column; gap: 12px; text-align: left; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field input { height: 40px; font-size: 15px; }
    .form .btn { height: 40px; }
    .notice { text-align: left; }
    .or { display: flex; align-items: center; gap: 10px; color: var(--text-3); font-size: 12px; }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--border); }
    .demo {
      height: 42px; border: 0; color: #fff; font-weight: 600;
      background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899); background-size: 200% 100%; animation: shimmer 3s linear infinite;
    }
    .demo:hover { opacity: 0.92; color: #fff; }
    @keyframes shimmer { to { background-position: -200% 0; } }
  `
})
export class LoginPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly registerOpen = signal(false);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected user = '';
  protected password = '';
  protected password2 = '';
  protected name = '';
  protected code = '';
  private readonly first = viewChild<ElementRef<HTMLInputElement>>('first');
  private readonly pw = viewChild<ElementRef<HTMLInputElement>>('pw');

  async ngOnInit(): Promise<void> {
    setTimeout(() => this.first()?.nativeElement.focus());
    try {
      const r = await firstValueFrom(this.http.get<{ open: boolean }>(`${API_ORIGIN}/api/auth/register`));
      this.registerOpen.set(!!r.open);
    } catch {
      this.error.set('No se pudo conectar con el servidor. ¿Está arrancado el back?');
    }
  }

  protected demo(): void {
    enterDemo();
  }

  protected switchTo(mode: 'login' | 'register'): void {
    this.mode.set(mode);
    this.error.set('');
    this.password = '';
    this.password2 = '';
    setTimeout(() => this.first()?.nativeElement.focus());
  }

  protected async login(): Promise<void> {
    if (!this.user || !this.password || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.http.post<{ token: string }>(`${API_ORIGIN}/api/auth/login`, { user: this.user.trim(), password: this.password }));
      this.password = '';
      enterAs(r.token);
    } catch (e) {
      this.fail(e, 'No se pudo entrar.');
      setTimeout(() => this.pw()?.nativeElement.focus());
    }
  }

  protected async register(): Promise<void> {
    if (this.busy()) return;
    if (this.password !== this.password2) {
      this.error.set('Las contraseñas no coinciden.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const body = { code: this.code.trim(), name: this.name.trim(), user: this.user.trim().toLowerCase(), password: this.password };
      const r = await firstValueFrom(this.http.post<{ token: string }>(`${API_ORIGIN}/api/auth/register`, body));
      this.password = this.password2 = '';
      enterAs(r.token);
    } catch (e) {
      this.fail(e, 'No se pudo crear la cuenta.');
    }
  }

  private fail(e: unknown, fallback: string): void {
    const msg = e instanceof HttpErrorResponse ? e.error?.error : null;
    this.error.set(msg || fallback);
    this.busy.set(false);
    this.password = '';
    this.password2 = '';
  }
}
