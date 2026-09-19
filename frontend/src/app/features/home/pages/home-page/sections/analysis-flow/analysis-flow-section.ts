import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PROTOCOL_STEPS } from './analysis-flow.data';
import { StepFilter, toProtocolStepViewModels } from './analysis-flow.presenter';
import { PhaseFilter } from './components/phase-filter/phase-filter';
import { StepCard } from './components/step-card/step-card';

@Component({
  selector: 'app-analysis-flow-section',
  imports: [CommonModule, PhaseFilter, StepCard],
  templateUrl: './analysis-flow-section.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisFlowSection {
  readonly activeFilter = signal<StepFilter>('all');
  private readonly allSteps = toProtocolStepViewModels(PROTOCOL_STEPS);
  readonly steps = computed(() => {
    const filter = this.activeFilter();
    return filter === 'all' ? this.allSteps : this.allSteps.filter((step) => step.phase === filter);
  });

  onFilterChange(filter: StepFilter): void {
    this.activeFilter.set(filter);
  }
}
