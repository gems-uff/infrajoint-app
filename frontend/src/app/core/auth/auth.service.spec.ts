import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { UserProfile } from './profile.model';
import { SupabaseService } from '../supabase/supabase.service';

const PROFILE: UserProfile = {
  id: 'u1',
  full_name: 'Ada Lovelace',
  avatar_url: null,
  role: 'admin',
};

interface SetupOptions {
  /** Returns whether the next profile fetch should fail. */
  shouldFail: () => boolean;
}

/**
 * Builds an AuthService backed by a mock Supabase client whose `users` query
 * either fails or returns {@link PROFILE}, toggled per call via `shouldFail`.
 */
function setup({ shouldFail }: SetupOptions) {
  const single = vi.fn(() =>
    shouldFail()
      ? Promise.resolve({ data: null, error: { message: 'transient' } })
      : Promise.resolve({ data: PROFILE, error: null }),
  );

  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single,
    }),
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: SupabaseService, useValue: { client } },
    ],
  });

  return { auth: TestBed.inject(AuthService), single };
}

describe('AuthService profile loading', () => {
  it('retries after a transient failure instead of caching the failed load', async () => {
    let failing = true;
    const { auth } = setup({ shouldFail: () => failing });

    // First access fails: the profile stays null and the memo is cleared.
    expect(await auth.ensureProfileLoaded()).toBeNull();
    expect(auth.profile()).toBeNull();

    // The transient error clears: the next access must retry and succeed,
    // without requiring a new sign-in.
    failing = false;
    expect(await auth.ensureProfileLoaded()).toEqual(PROFILE);
    expect(auth.profile()).toEqual(PROFILE);
  });

  it('deduplicates concurrent successful loads into a single request', async () => {
    const { auth, single } = setup({ shouldFail: () => false });
    await auth.ready;

    const [a, b] = await Promise.all([auth.ensureProfileLoaded(), auth.ensureProfileLoaded()]);

    expect(a).toEqual(PROFILE);
    expect(b).toEqual(PROFILE);
    expect(single).toHaveBeenCalledTimes(1);
  });
});
