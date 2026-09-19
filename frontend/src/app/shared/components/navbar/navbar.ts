import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  inject,
  input,
  signal,
} from '@angular/core';
import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';

import { AuthService } from '../../../core/auth/auth.service';
import { UserAvatar } from '../user-avatar/user-avatar';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, NgOptimizedImage, LucideDynamicIcon, UserAvatar],
  templateUrl: './navbar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class Navbar implements AfterViewInit, OnDestroy {
  @ViewChild('navbar') private navbar?: ElementRef<HTMLElement>;

  private readonly ngZone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly auth = inject(AuthService);

  /** Whether to show the marketing site links (Home, Recursos, …). */
  readonly showSiteLinks = input(true);

  /** Whether the mobile navigation drawer is open. */
  protected readonly drawerOpen = signal(false);

  protected readonly isAuthenticated = this.auth.isAuthenticated;

  protected toggleDrawer(): void {
    if (this.drawerOpen()) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  }

  protected openDrawer(): void {
    this.drawerOpen.set(true);
    this.setBodyScrollLock(true);
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
    this.setBodyScrollLock(false);
  }

  protected onEscape(): void {
    if (this.drawerOpen()) {
      this.closeDrawer();
    }
  }

  /** Prevents the page behind the open drawer from scrolling. */
  private setBodyScrollLock(locked: boolean): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    document.body.style.overflow = locked ? 'hidden' : '';
  }

  private animationContext?: { revert: () => void };
  private destroyed = false;
  private readonly topThreshold = 80;
  private readonly scrollDelta = 8;
  private gsap?: typeof import('gsap')['gsap'];
  private lastScrollY = 0;
  private hidden = false;
  private ticking = false;
  private onScroll?: () => void;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId) || !this.navbar) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      void this.animateEntrance();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.animationContext?.revert();
    this.setBodyScrollLock(false);

    if (this.onScroll && isPlatformBrowser(this.platformId)) {
      window.removeEventListener('scroll', this.onScroll);
    }
  }

  private async animateEntrance(): Promise<void> {
    const { gsap } = await import('gsap');

    if (this.destroyed || !this.navbar) {
      return;
    }

    this.gsap = gsap;

    this.animationContext = gsap.context(() => {
      gsap.from(this.navbar!.nativeElement, {
        autoAlpha: 0,
        duration: 0.7,
        ease: 'power3.out',
        y: -12,
      });
    }, this.navbar.nativeElement);

    this.setupAutoHide();
  }

  private setupAutoHide(): void {
    this.lastScrollY = window.scrollY;

    this.onScroll = () => {
      if (this.ticking) {
        return;
      }

      this.ticking = true;
      window.requestAnimationFrame(() => {
        this.handleScroll();
        this.ticking = false;
      });
    };

    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  private handleScroll(): void {
    const current = Math.max(window.scrollY, 0);

    // Always reveal near the top so small scrolls never hide the navbar.
    if (current <= this.topThreshold) {
      this.reveal();
      this.lastScrollY = current;
      return;
    }

    if (Math.abs(current - this.lastScrollY) <= this.scrollDelta) {
      return;
    }

    if (current > this.lastScrollY) {
      this.conceal();
    } else {
      this.reveal();
    }

    this.lastScrollY = current;
  }

  private reveal(): void {
    if (!this.hidden || !this.navbar) {
      return;
    }

    this.hidden = false;
    this.gsap?.to(this.navbar.nativeElement, {
      yPercent: 0,
      duration: 0.75,
      ease: 'power2.out',
    });
  }

  private conceal(): void {
    if (this.hidden || !this.navbar) {
      return;
    }

    this.hidden = true;
    this.gsap?.to(this.navbar.nativeElement, {
      yPercent: -100,
      duration: 0.55,
      ease: 'power2.in',
    });
  }
}
