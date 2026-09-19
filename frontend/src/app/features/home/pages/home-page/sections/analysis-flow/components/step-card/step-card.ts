import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { LucideDynamicIcon } from '@lucide/angular';
import { ProtocolStepViewModel, StepTone } from '../../analysis-flow.presenter';

@Component({
  selector: 'app-step-card',
  imports: [CommonModule, LucideDynamicIcon],
  templateUrl: './step-card.html',
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('expandCollapse', [
      state('void', style({ height: '0', overflow: 'hidden' })),
      state('*', style({ height: '*' })),
      transition('void <=> *', animate('200ms ease')),
    ]),
  ],
})
export class StepCard {
  readonly step = input.required<ProtocolStepViewModel>();
  readonly isFirst = input(false);
  readonly isLast = input(false);
  readonly isOpen = signal(false);

  readonly dotClasses = computed(() => {
    const base =
      'absolute left-0 top-1/2 z-20 flex h-9 w-9 -translate-x-[39px] -translate-y-1/2 items-center justify-center rounded-full border text-xs font-medium';
    const map: Record<StepTone, string> = {
      info: 'bg-blue-50 text-blue-700 border-blue-200',
      success: 'bg-green-50 text-green-700 border-green-200',
      warning: 'bg-amber-50 text-amber-700 border-amber-200',
      danger: 'bg-red-50 text-red-700 border-red-200',
      neutral: 'bg-gray-100 text-gray-700 border-gray-200',
      purple: 'bg-purple-50 text-purple-700 border-purple-200',
    };
    return `${base} ${map[this.step().tone]}`;
  });

  readonly lineColor = computed(() => {
    const map: Record<StepTone, string> = {
      info: 'bg-blue-100',
      success: 'bg-green-100',
      warning: 'bg-amber-100',
      danger: 'bg-red-100',
      neutral: 'bg-gray-200',
      purple: 'bg-purple-100',
    };
    return map[this.step().tone];
  });

  readonly iconClasses = computed(() => {
    const base = 'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base';
    const map: Record<StepTone, string> = {
      info: 'bg-blue-50 text-blue-700',
      success: 'bg-green-50 text-green-700',
      warning: 'bg-amber-50 text-amber-700',
      danger: 'bg-red-50 text-red-700',
      neutral: 'bg-gray-100 text-gray-700',
      purple: 'bg-purple-50 text-purple-700',
    };
    return `${base} ${map[this.step().tone]}`;
  });

  readonly progressBarColor = computed(() => {
    const map: Record<StepTone, string> = {
      info: 'bg-blue-400',
      success: 'bg-green-400',
      warning: 'bg-amber-400',
      danger: 'bg-red-400',
      neutral: 'bg-gray-400',
      purple: 'bg-purple-400',
    };
    return map[this.step().tone];
  });

  readonly tagClasses = computed(() => {
    const base = 'text-xs px-2 py-0.5 rounded-full border';
    const map: Record<StepTone, string> = {
      info: 'bg-blue-50 text-blue-700 border-blue-200',
      success: 'bg-green-50 text-green-700 border-green-200',
      warning: 'bg-amber-50 text-amber-700 border-amber-200',
      danger: 'bg-red-50 text-red-700 border-red-200',
      neutral: 'bg-gray-50 text-gray-600 border-gray-200',
      purple: 'bg-purple-50 text-purple-700 border-purple-200',
    };
    return `${base} ${map[this.step().tone]}`;
  });

  readonly groupClasses = computed(() => {
    const map: Record<StepTone, string> = {
      info: 'bg-blue-50 text-blue-700',
      success: 'bg-green-50 text-green-700',
      warning: 'bg-amber-50 text-amber-700',
      danger: 'bg-red-50 text-red-700',
      neutral: 'bg-gray-50 text-gray-600',
      purple: 'bg-purple-50 text-purple-700',
    };
    return map[this.step().tone];
  });

  readonly noteToneClasses = computed(() => {
    const map: Record<StepTone, string> = {
      info: 'border-blue-300 bg-blue-50 text-blue-700',
      success: 'border-green-300 bg-green-50 text-green-700',
      warning: 'border-amber-300 bg-amber-50 text-amber-700',
      danger: 'border-red-300 bg-red-50 text-red-700',
      neutral: 'border-gray-300 bg-gray-50 text-gray-600',
      purple: 'border-purple-300 bg-purple-50 text-purple-700',
    };
    return map[this.step().tone];
  });

  toggle(): void {
    this.isOpen.update((isOpen) => !isOpen);
  }
}
 