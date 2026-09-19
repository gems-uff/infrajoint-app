import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LucideMenu, LucideShieldCheck, LucideX, provideLucideIcons } from '@lucide/angular';

import { AuthService } from '../../../../core/auth/auth.service';
import { PRIVACY_POLICY_SECTIONS } from '../../privacy-policy.data';
import { PrivacyPolicyPage } from './privacy-policy-page';

/** Minimal stand-in so the navbar renders without touching Supabase. */
const authStub = { isAuthenticated: signal(false) };

describe('PrivacyPolicyPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PrivacyPolicyPage],
      providers: [
        provideRouter([]),
        provideLucideIcons(LucideMenu, LucideShieldCheck, LucideX),
        { provide: AuthService, useValue: authStub },
      ],
    }).compileComponents();
  });

  it('should create the page', () => {
    const fixture = TestBed.createComponent(PrivacyPolicyPage);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render one anchored section per policy entry', async () => {
    const fixture = TestBed.createComponent(PrivacyPolicyPage);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;

    for (const section of PRIVACY_POLICY_SECTIONS) {
      const element = host.querySelector(`section#${section.id}`);
      expect(element, `missing section: ${section.id}`).toBeTruthy();
      expect(element?.textContent).toContain(section.title);
    }
  });

  it('should list every section in the table of contents', async () => {
    const fixture = TestBed.createComponent(PrivacyPolicyPage);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const links = host.querySelectorAll('nav[aria-label^="Sumário"] a');

    expect(links.length).toBe(PRIVACY_POLICY_SECTIONS.length);
  });
});

describe('privacy policy content', () => {
  it('should use unique anchors so deep links resolve', () => {
    const ids = PRIVACY_POLICY_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should not contain empty sections', () => {
    for (const section of PRIVACY_POLICY_SECTIONS) {
      expect(section.blocks.length, `empty section: ${section.id}`).toBeGreaterThan(0);
    }
  });
});
