import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { isDemo, leaveDemo } from '../demo/demo-mode';
import { API_ORIGIN } from './api-origin';

/**
 * Who is using the app. The entry screen logs in (user + password, POST /api/auth/login) and keeps the session token
 * in this browser. Every request to the back carries it ("Authorization: Bearer …"); the back takes the user from the
 * token and the database only returns that user's rows (row level security, see back/supabase/users.sql).
 */
const KEY = 'finanzas.token';
/** Old key (before the login): removed on load. */
const OLD_KEY = 'finanzas.user';

type Claims = { sub: string; name: string; exp: number };

function claims(): Claims | null {
  try {
    localStorage.removeItem(OLD_KEY);
    const token = localStorage.getItem(KEY);
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as Claims;
    if (!payload.sub || payload.exp * 1000 <= Date.now()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** User id of this session (null = entry screen). The back checks the token's signature on every request. */
export function sessionUser(): string | null {
  // Demo mode: the fictitious "demo" user, without login (demo/demo-mode.ts).
  if (isDemo()) return 'demo';
  return claims()?.sub ?? null;
}

export function sessionName(): string {
  if (isDemo()) return 'Demo';
  return claims()?.name ?? '';
}

function token(): string | null {
  try {
    return claims() ? localStorage.getItem(KEY) : null;
  } catch {
    return null;
  }
}

/** Starts a session (token from the login) or ends it (null). Reloads so nothing of the previous user stays in memory. */
export function enterAs(newToken: string | null): void {
  if (!newToken && isDemo()) return leaveDemo();
  try {
    if (newToken) localStorage.setItem(KEY, newToken);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  location.reload();
}

export const userInterceptor: HttpInterceptorFn = (req, next) => {
  // The token only goes to our back end, never to another site the app may read from.
  const t = req.url.startsWith(`${API_ORIGIN}/`) ? token() : null;
  return next(t ? req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : req).pipe(
    catchError((error: unknown) => {
      // Expired or invalid session while using the app: back to the entry screen.
      if (error instanceof HttpErrorResponse && error.status === 401 && t && !req.url.includes('/api/auth/')) enterAs(null);
      return throwError(() => error);
    })
  );
};
