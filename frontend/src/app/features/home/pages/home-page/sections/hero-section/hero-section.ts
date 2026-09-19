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
} from '@angular/core';
import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-hero-section',
  imports: [RouterLink, NgOptimizedImage],
  templateUrl: './hero-section.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroSection implements AfterViewInit, OnDestroy {
  @ViewChild('heroSection') private heroSection?: ElementRef<HTMLElement>;
  @ViewChild('heroBackground') private heroBackground?: ElementRef<HTMLImageElement>;
  @ViewChild('heroContent') private heroContent?: ElementRef<HTMLElement>;

  private readonly ngZone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  private animationContext?: { revert: () => void };
  private destroyed = false;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId) || !this.heroSection || !this.heroBackground) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      void this.setupHeroScrollAnimation();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.animationContext?.revert();
  }

  private async setupHeroScrollAnimation(): Promise<void> {
    const [{ gsap }, { ScrollTrigger }] = await Promise.all([
      import('gsap'),
      import('gsap/ScrollTrigger'),
    ]);

    if (this.destroyed || !this.heroSection || !this.heroBackground || !this.heroContent) {
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const section = this.heroSection.nativeElement;
    const background = this.heroBackground.nativeElement;
    const content = this.heroContent.nativeElement;

    this.animationContext = gsap.context(() => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      gsap.set(background, {
        force3D: true,
        scale: 1,
        transformOrigin: '50% 50%',
      });

      if (reducedMotion) {
        return;
      }

      gsap
        .timeline({
          defaults: {
            ease: 'none',
          },
          scrollTrigger: {
            trigger: document.documentElement,
            start: 'top top',
            end: () => `+=${ScrollTrigger.maxScroll(window)}`,
            scrub: 1.05,
            invalidateOnRefresh: true,
          },
        })
        .to(
          background,
          {
            scale: 1.4,
          },
          0,
        );

      gsap.from(content, {
        autoAlpha: 0,
        duration: 0.8,
        ease: 'power3.out',
        y: 14,
      });

      if (!background.complete) {
        background.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
      }
    }, section);
  }
}
