import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideDynamicIcon } from '@lucide/angular';

export type PlatformFeatureIcon =
  | 'chart-no-axes-combined'
  | 'layers'
  | 'target'
  | 'timeline'
  | 'workflow';
export type PlatformFeatureVariant = 'architecture' | 'visualization' | 'roi' | 'timeline' | 'metrics';

export interface PlatformFeature {
  readonly title: string;
  readonly description: string;
  readonly icon: PlatformFeatureIcon;
  readonly variant: PlatformFeatureVariant;
}

@Component({
  selector: 'app-platform-feature-card',
  imports: [CommonModule, LucideDynamicIcon],
  templateUrl: './platform-feature-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full min-w-0',
  },
})
export class PlatformFeatureCard {
  readonly feature = input.required<PlatformFeature>();

  iconShellClasses(variant: PlatformFeatureVariant): string {
    const map: Record<PlatformFeatureVariant, string> = {
      architecture: 'bg-[#EAF2F8] text-[#1B3A57]',
      visualization: 'bg-[#E5F1FA] text-[#246BA8]',
      roi: 'bg-[#E5F8FF] text-[#32B5FE]',
      timeline: 'bg-[#E8F4FB] text-[#4A91C7]',
      metrics: 'bg-[#EDF7FC] text-[#68A9D6]',
    };

    return `platform-feature-icon ${map[variant]}`;
  }
}
