import {
  Injectable,
  NgZone,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type {
  AuthResponse,
  AuthTokenResponsePassword,
  OAuthResponse,
  Session,
  User,
} from '@supabase/supabase-js';

import { SupabaseService } from '../supabase/supabase.service';
import { UserProfile } from './profile.model';

/**
 * Centralized authentication state for the application.
 *
 * Responsibilities:
 * - Load the current session on startup via `auth.getSession()`.
 * - Expose the session/user and a `loading` flag as signals.
 * - Subscribe to `auth.onAuthStateChange()` and keep state in sync on
 *   sign-in, sign-out, token refresh and any other auth event.
 *
 * Token lifecycle is owned entirely by the Supabase SDK — we never read,
 * store or refresh JWTs ourselves. The session signal is always derived
 * from what Supabase reports.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly zone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _session = signal<Session | null>(null);
  private readonly _loading = signal(true);
  private readonly _profile = signal<UserProfile | null>(null);

  /** Tracks which user id the current profile was loaded for. */
  private profileUserId: string | null = null;

  /**
   * In-flight (or last completed) profile load. Used both to dedupe concurrent
   * requests and to let callers (e.g. the role guard) await profile readiness.
   */
  private profileLoad: { userId: string; promise: Promise<UserProfile | null> } | null = null;

  /** Current Supabase session, or `null` when signed out. */
  readonly session = this._session.asReadonly();
  /** `true` while the initial session is being resolved. */
  readonly loading = this._loading.asReadonly();
  /** The authenticated user, derived from the session. */
  readonly user = computed<User | null>(() => this._session()?.user ?? null);
  /** Whether there is an active authenticated session. */
  readonly isAuthenticated = computed(() => this._session() !== null);
  /** The authenticated user's `public.users` profile row, or `null`. */
  readonly profile = this._profile.asReadonly();

  /** Resolves once the initial auth state has been determined. */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.ready = new Promise<void>((resolve) => (this.resolveReady = resolve));

    // No session handling during SSR/prerender — the client re-evaluates
    // everything once it hydrates in the browser.
    if (!this.isBrowser) {
      this._loading.set(false);
      this.resolveReady();
      return;
    }

    void this.loadInitialSession();

    this.supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase fires this listener outside Angular's zone; run inside it so
      // change detection picks up the signal updates.
      this.zone.run(() => {
        this._session.set(session);
        this._loading.set(false);
      });
    });

    // Keep the profile in sync with the authenticated user: load it after
    // sign-in / session restore, skip redundant reloads on token refresh
    // (same user id), and clear it on sign-out.
    effect(() => {
      const userId = this.user()?.id ?? null;

      if (userId === null) {
        this._profile.set(null);
        this.profileUserId = null;
        this.profileLoad = null;
        return;
      }

      if (userId === this.profileUserId) {
        return;
      }

      this.profileUserId = userId;
      void this.loadProfile(userId);
    });
  }

  private async loadInitialSession(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    this._session.set(data.session);
    this._loading.set(false);
    this.resolveReady();
  }

  private loadProfile(userId: string): Promise<UserProfile | null> {
    // Reuse an in-flight (or successfully completed) load for the same user so
    // the auth effect and any awaiting caller share a single request. Failed
    // loads clear this memo (see below), so they are retried rather than reused.
    if (this.profileLoad?.userId === userId) {
      return this.profileLoad.promise;
    }

    const promise = (async (): Promise<UserProfile | null> => {
      const { data, error } = await this.supabase
        .from('users')
        .select('id, full_name, avatar_url, role')
        .eq('id', userId)
        .single<UserProfile>();

      // Ignore a result that arrived after the user changed (or signed out).
      if (this.user()?.id !== userId) {
        return this._profile();
      }

      // A failed load (transient network/Supabase error) must not stay cached:
      // drop the memo and the tracked user id so the next ensureProfileLoaded()
      // or auth event retries instead of permanently reusing the failed promise.
      if (error) {
        this.profileLoad = null;
        this.profileUserId = null;
        this._profile.set(null);
        return null;
      }

      this._profile.set(data);
      return data;
    })();

    this.profileLoad = { userId, promise };
    return promise;
  }

  /**
   * Resolves once the authenticated user's profile has been loaded, returning
   * it (or `null` when signed out / unavailable). Guards use this to read the
   * user's role reliably, even on a cold direct-URL navigation where the
   * reactive profile effect has not settled yet.
   */
  async ensureProfileLoaded(): Promise<UserProfile | null> {
    await this.ready;

    const userId = this.user()?.id;
    if (!userId) {
      return null;
    }

    await this.loadProfile(userId);
    return this._profile();
  }

  signInWithPassword(email: string, password: string): Promise<AuthTokenResponsePassword> {
    return this.supabase.auth.signInWithPassword({ email, password });
  }

  signUp(email: string, password: string, fullName: string): Promise<AuthResponse> {
    return this.supabase.auth.signUp({
      email,
      password,
      // Forwarded to `raw_user_meta_data`; the `handle_new_user` trigger reads
      // `full_name` from it to populate the profile row.
      options: { data: { full_name: fullName } },
    });
  }

  /**
   * Starts the Google OAuth flow. This is a full-page redirect to Google and
   * back to `/auth/callback`, where the SDK detects the session from the URL
   * (`detectSessionInUrl`) and `onAuthStateChange` fires `SIGNED_IN`.
   *
   * The same call handles both sign-in and sign-up: a first-time Google user is
   * created automatically, and the `handle_new_user` trigger populates the
   * profile from the metadata Google returns (`full_name`, `avatar_url`).
   */
  signInWithGoogle(): Promise<OAuthResponse> {
    return this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  signOut(): Promise<{ error: Error | null }> {
    return this.supabase.auth.signOut();
  }

  /**
   * Updates the authenticated user's `public.users` profile row and refreshes
   * the local `profile` signal with the persisted result.
   *
   * The full name is also mirrored into the auth user metadata (`full_name`)
   * so it stays in sync with the "Display name" shown in Supabase Auth, which
   * is sourced from `raw_user_meta_data`, not the profile table.
   */
  async updateProfile(changes: {
    fullName: string | null;
    avatarUrl: string | null;
  }): Promise<{ error: Error | null }> {
    const userId = this.user()?.id;
    if (!userId) {
      return { error: new Error('Nenhum usuário autenticado.') };
    }

    const { data, error } = await this.supabase
      .from('users')
      .update({ full_name: changes.fullName, avatar_url: changes.avatarUrl })
      .eq('id', userId)
      .select('id, full_name, avatar_url, role')
      .single<UserProfile>();

    if (error) {
      return { error };
    }

    if (data && this.user()?.id === userId) {
      this._profile.set(data);
    }

    const { error: metadataError } = await this.supabase.auth.updateUser({
      data: { full_name: changes.fullName },
    });

    return { error: metadataError };
  }

  /**
   * Requests an email change for the authenticated user. Supabase sends a
   * confirmation link to the new address; the change only takes effect once
   * that link is followed.
   */
  async updateEmail(email: string): Promise<{ error: Error | null }> {
    const { error } = await this.supabase.auth.updateUser({ email });
    return { error };
  }

  /**
   * Uploads an avatar image to the `avatars` storage bucket under the user's
   * id and returns its public URL.
   */
  async uploadAvatar(file: File): Promise<{ url: string | null; error: Error | null }> {
    const userId = this.user()?.id;
    if (!userId) {
      return { url: null, error: new Error('Nenhum usuário autenticado.') };
    }

    // Stable path per user, independent of the file extension: every upload
    // overwrites the exact same object instead of creating one file per type
    // (which would orphan the previous avatar). The image type is preserved via
    // the `contentType` header below, so the browser still renders it correctly.
    const path = `${userId}/avatar`;

    const { error: uploadError } = await this.supabase.storage
      .from('avatars')
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });

    if (uploadError) {
      return { url: null, error: uploadError };
    }

    const { data } = this.supabase.storage.from('avatars').getPublicUrl(path);
    // Cache-bust: the public URL is otherwise identical across uploads, so add a
    // version query param to force browsers/CDN to fetch the new image.
    return { url: `${data.publicUrl}?v=${Date.now()}`, error: null };
  }
}
