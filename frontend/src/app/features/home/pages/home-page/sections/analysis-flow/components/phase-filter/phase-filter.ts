import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { StepFilter } from '../../analysis-flow.presenter';

interface PhaseFilterOption {
  value: StepFilter;
  label: string;
}

@Component({
  selector: 'app-phase-filter',
  imports: [CommonModule],
  templateUrl: './phase-filter.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhaseFilter {
  readonly activeFilter = input<StepFilter>('all');
  readonly filterChange = output<StepFilter>();

  readonly filters: PhaseFilterOption[] = [
    { value: 'all', label: 'Todas as etapas' },
    { value: 'prep', label: 'Preparação' },
    { value: 'cap', label: 'Captura' },
    { value: 'cli', label: 'Clínica' },
  ];

  setFilter(filter: StepFilter): void {
    if (filter === this.activeFilter()) {
      return;
    }

    this.filterChange.emit(filter);
  }

  buttonClasses(filter: StepFilter): string {
    if (filter === this.activeFilter()) {
      return 'filter-pill filter-pill-active';
    }

    return 'filter-pill';
  }
}
