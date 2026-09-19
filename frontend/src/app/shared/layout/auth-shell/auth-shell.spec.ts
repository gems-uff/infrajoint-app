import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';
import { UserProfile, UserRole } from '../../../core/auth/profile.model';
import { AuthShell } from './auth-shell';

/** Shape of the private nav tree, narrowed to what these tests assert on. */
interface VisibleEntry {
  readonly label: string;
  readonly kind: 'link' | 'group';
  readonly children?: readonly VisibleEntry[];
}

function visibleNavFor(role: UserRole | undefined): readonly VisibleEntry[] {
  const profile = signal<UserProfile | null>(role ? ({ role } as UserProfile) : null);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: AuthService,
        useValue: { user: signal(null), profile, signOut: vi.fn() },
      },
    ],
  });

  const shell = TestBed.createComponent(AuthShell).componentInstance;
  const visibleNav = (shell as unknown as { visibleNav: () => readonly VisibleEntry[] }).visibleNav;
  return visibleNav();
}

/** Top-level labels only. */
function labelsFor(role: UserRole | undefined): readonly string[] {
  return visibleNavFor(role).map((entry) => entry.label);
}

/**
 * Every label, groups and their children flattened.
 *
 * Filtering happens at two levels, and a group can survive while a child of it is
 * hidden. Asserting only on the top level would let a leaked child pass.
 */
function allLabelsFor(role: UserRole | undefined): readonly string[] {
  return visibleNavFor(role).flatMap((entry) => [
    entry.label,
    ...(entry.children ?? []).map((child) => child.label),
  ]);
}

describe('AuthShell sidebar visibility', () => {
  it('hides Pacientes from a reader', () => {
    const labels = labelsFor('user');
    expect(labels).not.toContain('Pacientes');
    expect(labels).toContain('Dashboard');
  });

  it('shows Pacientes to a médico', () => {
    expect(labelsFor('medico')).toContain('Pacientes');
  });

  // Regression guard: strict equality on a single `requiredRole` hid médico-scoped
  // entries from admins, who are supposed to see everything.
  it('shows Pacientes to an admin', () => {
    expect(labelsFor('admin')).toContain('Pacientes');
  });

  it('hides every gated entry while the profile is still unresolved', () => {
    expect(labelsFor(undefined)).not.toContain('Pacientes');
  });

  describe('gated children inside a group', () => {
    // Análise is ungated as a group, so it stays visible to everyone. Only the
    // entry that writes to a prontuário is restricted.
    it('hides Análise térmica from a reader but keeps the open tools', () => {
      const labels = allLabelsFor('user');
      expect(labels).toContain('Análise');
      expect(labels).toContain('Analisador de imagens');
      expect(labels).not.toContain('Análise térmica');
    });

    it('shows Análise térmica to a médico and to an admin', () => {
      expect(allLabelsFor('medico')).toContain('Análise térmica');
      expect(allLabelsFor('admin')).toContain('Análise térmica');
    });
  });
});
