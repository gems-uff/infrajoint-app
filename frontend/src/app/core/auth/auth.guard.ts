import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';
import { UserRole } from './profile.model';

/**
 * AUTHORIZATION NOTE — these guards are UX / navigation helpers only.
 *
 * They improve the experience (redirect anonymous users to login, hide screens
 * a role can't use) but enforce nothing on their own: anyone can bypass them via
 * devtools or by calling Supabase directly with the anon key. The source of
 * truth for authorization is Supabase Row-Level Security (and storage policies)
 * — every table/bucket must restrict reads/writes server-side. Never let a
 * business-critical rule depend on a guard; back it with an RLS policy first.
 */

/**
 * Protects routes that require an authenticated user.
 * Redirects to `/login` when there is no active session.
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // These routes are client-rendered; allow SSR/prerender through and let the
  // guard make the real decision after hydration.
  if (!isBrowser) {
    return true;
  }

  // Wait for the initial session check so we never redirect prematurely while
  // auth state is still loading.
  await auth.ready;

  return auth.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

/**
 * Guest-only routes (login / register). Authenticated users are sent to the
 * main authenticated area instead of seeing these screens.
 */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  if (!isBrowser) {
    return true;
  }

  await auth.ready;

  return auth.isAuthenticated() ? router.createUrlTree(['/dashboard']) : true;
};

/**
 * Restricts a route to users holding one of the roles declared in the route's
 * `data.roles`. Reusable across features — attach `canActivate: [roleGuard]`
 * and `data: { roles: ['admin'] }` to any route (run it alongside `authGuard`,
 * which already enforces authentication).
 *
 * A route without `data.roles` is treated as unrestricted.
 *
 * Role gating here is cosmetic (it keeps users out of screens they can't use);
 * the data those screens reach must still be protected by RLS — see the
 * authorization note at the top of this file.
 */
export const roleGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Client-rendered area: let SSR/prerender through and decide after hydration.
  if (!isBrowser) {
    return true;
  }

  const requiredRoles = (route.data['roles'] as readonly UserRole[] | undefined) ?? [];
  if (requiredRoles.length === 0) {
    return true;
  }

  const profile = await auth.ensureProfileLoaded();

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  if (profile && requiredRoles.includes(profile.role)) {
    return true;
  }

  // Authenticated but unauthorized — send them back to a page they can access.
  return router.createUrlTree(['/dashboard']);
};
