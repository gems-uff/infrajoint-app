import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Footer } from '../../../../shared/components/footer/footer';
import { Navbar } from '../../../../shared/components/navbar/navbar';
import { AnalysisFlowSection } from './sections/analysis-flow/analysis-flow-section';
import { AboutSection } from './sections/about-section/about-section';
import { HeroSection } from './sections/hero-section/hero-section';
import { ResourcesSection } from './sections/resources-section/resources-section';

@Component({
  selector: 'app-home-page',
  imports: [
    Navbar,
    Footer,
    HeroSection,
    ResourcesSection,
    AnalysisFlowSection,
    AboutSection,
  ],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {}
