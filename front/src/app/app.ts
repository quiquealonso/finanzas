import { enterAs, sessionName, sessionUser } from './core/session';
import { LoginPageComponent } from './features/login/login-page.component';
import { Component, HostListener, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { filter, firstValueFrom } from 'rxjs';
import { API_ORIGIN } from './core/api-origin';
import { isVisible, LAST_PAGE_KEY, NAV_GROUPS, PageDef, PAGES } from './app.routes';
import { isDemo, STATIC_SITE, startOnboarding } from './demo/demo-mode';
import { TourComponent } from './demo/tour.component';
import { TourService } from './demo/tour.service';
import { PortfolioStore } from './core/portfolio.store';
import { ConfirmDialogComponent } from './shared/confirm-dialog.component';
import { MovementDialogComponent } from './features/movements/movement-dialog.component';
import { formatMoney0, privacy, setPrivacy } from './shared/format.utils';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MovementDialogComponent, LoginPageComponent, ConfirmDialogComponent, TourComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly store = inject(PortfolioStore);
  protected readonly formatMoney0 = formatMoney0;
  protected readonly privacy = privacy;

  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  protected readonly tour = inject(TourService);
  /** Demo mode: example portfolio, no back end (demo/demo-mode.ts). */
  protected readonly demo = isDemo();
  protected readonly staticSite = STATIC_SITE;

  /** Sidebar: every page this user can see (pages and URLs live in app.routes.ts). */
  /** Sidebar: the visible pages, by group (NAV_GROUPS). */
  protected readonly navGroups = (() => {
    const visible = PAGES.filter((p) => isVisible(p.path));
    const grouped = NAV_GROUPS.map((g) => ({
      label: g.label,
      items: g.paths.map((path) => visible.find((p) => p.path === path)).filter((p): p is PageDef => !!p),
    }));
    const rest = visible.filter((p) => !NAV_GROUPS.some((g) => g.paths.includes(p.path)));
    return [...grouped, { label: 'Otros', items: rest }].filter((g) => g.items.length);
  })();

  /** User of this session (null = entry screen). */
  protected readonly user = sessionUser();
  protected readonly userName = signal(sessionName());

  constructor() {
    // Remember the last page, so "/" opens it next time.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      const path = (e as NavigationEnd).urlAfterRedirects.split(/[?#]/)[0].replace(/^\//, '');
      if (!PAGES.some((p) => p.path === path)) return;
      try {
        localStorage.setItem(LAST_PAGE_KEY, path);
      } catch {
        // Storage unavailable: the page just won't be remembered.
      }
    });
  }

  ngOnInit(): void {
    if (!this.user) return;
    if (!this.demo) void this.checkOnboarding();
    void this.store.refresh();
    this.tour.init();
  }

  /** A registered user who has not finished or skipped the tour gets it on every login (demo/demo-mode.ts). */
  private async checkOnboarding(): Promise<void> {
    try {
      const me = await firstValueFrom(this.http.get<{ id: string; tourPending: boolean }>(`${API_ORIGIN}/api/v2/me`));
      if (me.tourPending) startOnboarding(me.id);
    } catch {
      /* no answer: the app opens as usual */
    }
  }

  protected togglePrivacy(): void {
    setPrivacy(!privacy());
  }

  protected switchUser(): void {
    enterAs(null);
  }

  // "N" opens a new movement from anywhere (unless typing in a field).
  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName);
    if (event.key === 'Escape' && this.store.movementDialog()) this.store.closeMovement();
    // "H" hides or shows the amounts (privacy mode).
    if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      this.togglePrivacy();
    }
    if (!typing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n' && !this.store.movementDialog()) {
      event.preventDefault();
      this.store.openMovement();
    }
  }
}

