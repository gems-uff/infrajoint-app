import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { AuthService } from '../../../core/auth/auth.service';
import { AvatarService } from '../../../core/auth/avatar.service';
import { computeInitials } from '../../../core/auth/avatar.util';

/**
 * Renders the current user's avatar image, falling back to their initials when
 * no image is available or the image fails to load. Meant to be dropped inside
 * the caller's own circular container, which owns sizing and ring/hover styles.
 *
 * The resolved avatar (custom → OAuth provider photo) comes from
 * {@link AvatarService}, so every place that shows the user's photo stays
 * consistent and in sync with the auth state.
 */
@Component({
  selector: 'app-user-avatar',
  templateUrl: './user-avatar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserAvatar {
  private readonly auth = inject(AuthService);
  private readonly avatar = inject(AvatarService);

  /** Optional URL override (e.g. a live file preview) shown ahead of the resolved avatar. */
  readonly src = input<string | null>(null);
  /** Optional name used for the initials fallback (e.g. a live form value). */
  readonly nameOverride = input<string | null>(null);
  /** Tailwind classes applied to the initials text (font size/color). */
  readonly textClass = input('');

  /** URL that failed to load; retried automatically once the resolved URL changes. */
  private readonly failedSrc = signal<string | null>(null);

  /** Image URL to render, or `null` to fall back to initials. */
  protected readonly displayUrl = computed<string | null>(() => {
    const url = this.src() ?? this.avatar.avatarUrl();
    return url && url !== this.failedSrc() ? url : null;
  });

  protected readonly initials = computed(() => {
    const name = this.nameOverride();
    if (name && name.trim()) {
      return computeInitials(name, this.auth.user()?.email ?? null);
    }
    return this.avatar.initials();
  });

  protected onError(url: string): void {
    this.failedSrc.set(url);
  }
}
