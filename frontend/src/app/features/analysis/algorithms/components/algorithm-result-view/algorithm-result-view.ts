import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LucideDynamicIcon } from '@lucide/angular';

import { AlgorithmResult } from '../../algorithm.model';

/**
 * O resultado de um algoritmo, desenhado.
 *
 * O nome do arquivo carrega o sufixo `-view` porque `AlgorithmResult` já é o contrato
 * de dado em `algorithm.model.ts`, e a convenção do projeto casa nome de arquivo com
 * nome de classe. Sem o sufixo, os dois teriam o mesmo nome dizendo coisas diferentes.
 *
 * A tela é a mesma para todo algoritmo: a frase em cima, os números embaixo. Nenhum
 * algoritmo traz apresentação própria, e é isso que faz plugar um novo custar só a
 * conta, no servidor, sem uma linha aqui.
 *
 * Componente burro de propósito: recebe o resultado pronto e não sabe qual algoritmo o
 * produziu, nem se a conta foi sobre uma consulta ou sobre uma coorte.
 */
@Component({
  selector: 'app-algorithm-result-view',
  imports: [LucideDynamicIcon, DecimalPipe],
  templateUrl: './algorithm-result-view.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlgorithmResultView {
  readonly result = input.required<AlgorithmResult>();
  /** Título do algoritmo que produziu o resultado: ele precisa se identificar. */
  readonly title = input<string>('');
}
