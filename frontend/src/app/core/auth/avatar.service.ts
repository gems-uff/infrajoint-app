import { Injectable, computed, inject } from '@angular/core';

import { AuthService } from './auth.service';
import { computeInitials, resolveProviderAvatarUrl } from './avatar.util';

/**
 * Single source of truth for the user's display avatar.
 *
 * Resolution precedence:
 * 1. A custom avatar the user set inside the app (`public.users.avatar_url`).
 * 2. The photo returned by the OAuth provider (e.g. Google `avatar_url`),
 *    consumed directly from the provider URL — never uploaded to Storage.
 * 3. `null`, which callers render as an initials/placeholder fallback.
 *
 * Because everything derives from the reactive `profile`/`user` signals, the
 * avatar stays in sync automatically across sign-in, sign-out, session refresh
 * and any other auth-state change. Keeping the custom avatar first guarantees a
 * personalized image is never overwritten by the provider photo on later logins.
 */
@Injectable({ providedIn: 'root' })
export class AvatarService {
  private readonly auth = inject(AuthService);

  /** Photo provided by the OAuth provider metadata, or `null`. */
  readonly providerAvatarUrl = computed(() => resolveProviderAvatarUrl(this.auth.user()));

  /** Resolved avatar for display: custom avatar, else provider photo, else `null`. */
  readonly avatarUrl = computed<string | null>(() => {
    const custom = this.auth.profile()?.avatar_url?.trim();
    return custom ? custom : this.providerAvatarUrl();
  });

  /** Initials placeholder shown when no avatar image is available. */
  readonly initials = computed(() =>
    computeInitials(this.auth.profile()?.full_name ?? null, this.auth.user()?.email ?? null),
  );
}
