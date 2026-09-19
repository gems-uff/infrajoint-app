import type { User } from '@supabase/supabase-js';

/**
 * Avatar URL keys OAuth providers store in `user_metadata`, in priority order.
 * Supabase's Google provider populates both `avatar_url` and `picture`; other
 * providers commonly use only `picture`. Extend this list to support new
 * providers without touching the resolution logic.
 */
const PROVIDER_AVATAR_KEYS = ['avatar_url', 'picture'] as const;

/**
 * Extracts the profile photo an OAuth provider stored in the user's metadata
 * (e.g. the Google account picture), or `null` when none is present.
 *
 * The application never uploads this image — it is consumed directly from the
 * provider URL, so the value here is always a live, provider-hosted URL.
 */
export function resolveProviderAvatarUrl(user: User | null): string | null {
  const metadata = user?.user_metadata;
  if (!metadata) {
    return null;
  }

  for (const key of PROVIDER_AVATAR_KEYS) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

/**
 * Builds the initials fallback (up to two letters) shown when no avatar image
 * is available. Falls back to the first letter of the email, then `?`.
 */
export function computeInitials(name: string | null, email: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return (email?.[0] ?? '?').toUpperCase();
  }

  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
