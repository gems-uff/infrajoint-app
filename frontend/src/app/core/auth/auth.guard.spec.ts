import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { roleGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { UserProfile } from './profile.model';

const dashboardTree = { redirect: '/dashboard' } as unknown as UrlTree;
const loginTree = { redirect: '/login' } as unknown as UrlTree;

function runGuard(data: Record<string, unknown>, platform: 'browser' | 'server' = 'browser') {
  const auth = {
    ensureProfileLoaded: vi.fn<() => Promise<UserProfile | null>>(),
    isAuthenticated: vi.fn().mockReturnValue(true),
  };
  const router = {
    createUrlTree: vi.fn((commands: string[]) =>
      commands[0] === '/login' ? loginTree : dashboardTree,
    ),
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
    ],
  });

  const route = { data } as unknown as ActivatedRouteSnapshot;
  const invoke = () =>
    TestBed.runInInjectionContext(() => roleGuard(route, {} as RouterStateSnapshot));

  return { auth, router, invoke };
}

describe('roleGuard', () => {
  it('allows routes that declare no required roles', async () => {
    const { auth, invoke } = runGuard({});
    expect(await invoke()).toBe(true);
    expect(auth.ensureProfileLoaded).not.toHaveBeenCalled();
  });

  it('lets SSR/prerender through without checking the role', async () => {
    const { auth, invoke } = runGuard({ roles: ['admin'] }, 'server');
    expect(await invoke()).toBe(true);
    expect(auth.ensureProfileLoaded).not.toHaveBeenCalled();
  });

  it('grants access when the user holds a required role', async () => {
    const { auth, invoke } = runGuard({ roles: ['admin'] });
    auth.ensureProfileLoaded.mockResolvedValue({ role: 'admin' } as UserProfile);
    expect(await invoke()).toBe(true);
  });

  it('redirects an authenticated user lacking the role to the dashboard', async () => {
    const { auth, router, invoke } = runGuard({ roles: ['admin'] });
    auth.ensureProfileLoaded.mockResolvedValue({ role: 'user' } as UserProfile);
    expect(await invoke()).toBe(dashboardTree);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/dashboard']);
  });

  it('redirects an unauthenticated visitor to login', async () => {
    const { auth, router, invoke } = runGuard({ roles: ['admin'] });
    auth.isAuthenticated.mockReturnValue(false);
    auth.ensureProfileLoaded.mockResolvedValue(null);
    expect(await invoke()).toBe(loginTree);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login']);
  });
});
