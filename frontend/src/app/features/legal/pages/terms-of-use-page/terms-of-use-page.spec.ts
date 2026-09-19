import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LucideMenu, LucideShieldCheck, LucideX, provideLucideIcons } from '@lucide/angular';

import { AuthService } from '../../../../core/auth/auth.service';
import { TERMS_OF_USE_SECTIONS } from '../../terms-of-use.data';
import { TermsOfUsePage } from './terms-of-use-page';

/** Minimal stand-in so the navbar renders without touching Supabase. */
const authStub = { isAuthenticated: signal(false) };

describe('TermsOfUsePage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TermsOfUsePage],
      providers: [
        provideRouter([]),
        provideLucideIcons(LucideMenu, LucideShieldCheck, LucideX),
        { provide: AuthService, useValue: authStub },
      ],
    }).compileComponents();
  });

  it('should create the page', () => {
    const fixture = TestBed.createComponent(TermsOfUsePage);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render one anchored section per entry, all listed in the summary', async () => {
    const fixture = TestBed.createComponent(TermsOfUsePage);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;

    for (const section of TERMS_OF_USE_SECTIONS) {
      const element = host.querySelector(`section#${section.id}`);
      expect(element, `missing section: ${section.id}`).toBeTruthy();
      expect(element?.textContent).toContain(section.title);
    }

    const links = host.querySelectorAll('nav[aria-label^="Sumário"] a');
    expect(links.length).toBe(TERMS_OF_USE_SECTIONS.length);
  });
});

describe('terms of use content', () => {
  it('should use unique anchors so deep links resolve', () => {
    const ids = TERMS_OF_USE_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should not contain empty sections', () => {
    for (const section of TERMS_OF_USE_SECTIONS) {
      expect(section.blocks.length, `empty section: ${section.id}`).toBeGreaterThan(0);
    }
  });
});
