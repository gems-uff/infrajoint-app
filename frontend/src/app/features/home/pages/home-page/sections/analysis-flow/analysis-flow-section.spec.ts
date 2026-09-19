import { TestBed } from '@angular/core/testing';
import {
  LucideCamera,
  LucideFlame,
  LucideSettings,
  LucideStethoscope,
  LucideThermometer,
  LucideUserRound,
  LucideWind,
  provideLucideIcons,
} from '@lucide/angular';
import { AnalysisFlowSection } from './analysis-flow-section';

describe('AnalysisFlowSection', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisFlowSection],
      providers: [
        provideLucideIcons(
          LucideCamera,
          LucideFlame,
          LucideSettings,
          LucideStethoscope,
          LucideThermometer,
          LucideUserRound,
          LucideWind,
        ),
      ],
    }).compileComponents();
  });

  it('should create the section', () => {
    const fixture = TestBed.createComponent(AnalysisFlowSection);
    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  it('should render the header', async () => {
    const fixture = TestBed.createComponent(AnalysisFlowSection);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h2')?.textContent).toContain('Fluxo');
  });
});
