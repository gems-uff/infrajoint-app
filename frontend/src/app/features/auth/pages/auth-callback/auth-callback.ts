import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../../../core/auth/auth.service';

/**
 * Landing page for the OAuth redirect (`/auth/callback`).
 *
 * The Supabase SDK detects the session from the URL on load
 * (`detectSessionInUrl`); this component just waits for the initial auth state
 * to settle and forwards the user to the app (or back to login on failure).
 */
@Component({
  selector: 'app-auth-callback',
  templateUrl: './auth-callback.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallback {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private redirected = false;

  constructor() {
    effect(() => {
      if (this.auth.loading() || this.redirected) {
        return;
      }

      this.redirected = true;
      void this.router.navigate([this.auth.isAuthenticated() ? '/dashboard' : '/login']);
    });
  }
}
