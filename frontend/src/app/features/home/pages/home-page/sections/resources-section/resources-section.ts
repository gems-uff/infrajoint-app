import { ChangeDetectionStrategy, Component } from '@angular/core';

import {
  PlatformFeature,
  PlatformFeatureCard,
} from '../../../../components/platform-feature-card/platform-feature-card';

@Component({
  selector: 'app-resources-section',
  imports: [PlatformFeatureCard],
  templateUrl: './resources-section.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourcesSection {
  protected readonly platformFeatures: readonly PlatformFeature[] = [
    {
      title: 'Integração de Algoritmos',
      description:
        'Arquitetura extensível para integração de algoritmos externos com saída padronizada.',
      icon: 'workflow',
      variant: 'architecture',
    },
    {
      title: 'Visualização Multimodal',
      description: 'Sobreposição de imagens térmicas e ópticas com controle de opacidade.',
      icon: 'layers',
      variant: 'visualization',
    },
    {
      title: 'Regiões de Interesse',
      description: 'Definição e manipulação de ROIs para extração de métricas por articulação.',
      icon: 'target',
      variant: 'roi',
    },
    {
      title: 'Evolução Temporal',
      description:
        'Histórico de exames por paciente e evolução de índices clínicos ao longo do tempo.',
      icon: 'timeline',
      variant: 'timeline',
    },
    {
      title: 'Métricas Quantitativas',
      description: 'Cálculo automatizado de CDAI e DAS28 a partir dos dados do exame.',
      icon: 'chart-no-axes-combined',
      variant: 'metrics',
    },
  ];
}
