import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

import { DiagnosisCatalog, PatientDiagnosis } from '../../data/patient.model';

/**
 * Escolha dos diagnósticos do paciente, a partir do catálogo da CID-10.
 *
 * Fora do `FormGroup` de propósito: diagnóstico deixou de ser um campo de texto e virou
 * uma relação com cardinalidade própria. Modelá-lo como controle exigiria um
 * `ControlValueAccessor` para representar uma lista que a tela edita por adicionar e
 * remover, e não por digitar. O estado entra e sai por `model()`, e a página o junta ao
 * resto no envio.
 *
 * O recorte do catálogo cabe num `select` simples: são cerca de 17 diagnósticos, não os
 * ~14 mil da classificação inteira.
 */
@Component({
  selector: 'app-diagnosis-picker',
  standalone: true,
  templateUrl: './diagnosis-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiagnosisPicker {
  readonly catalog = input.required<readonly DiagnosisCatalog[]>();
  readonly selected = model<readonly PatientDiagnosis[]>([]);

  /** O que ainda dá para acrescentar: o catálogo menos o que já está escolhido. */
  protected readonly disponiveis = computed(() => {
    const escolhidos = new Set(this.selected().map((d) => d.code));
    return this.catalog().filter((d) => !escolhidos.has(d.code));
  });

  protected adicionar(code: string): void {
    if (!code) {
      return;
    }
    const item = this.catalog().find((d) => d.code === code);
    if (!item) {
      return;
    }
    // O primeiro escolhido vira o principal; os seguintes entram como secundários. Sem
    // isso, um paciente com diagnóstico ficaria sem principal até alguém marcar um.
    const primeiro = this.selected().length === 0;
    this.selected.set([
      ...this.selected(),
      { code: item.code, label: item.label, is_primary: primeiro },
    ]);
  }

  protected remover(code: string): void {
    const restantes = this.selected().filter((d) => d.code !== code);
    // Removido o principal, o próximo assume: "principal" não pode ficar vago enquanto
    // houver diagnóstico, e o banco tem índice único garantindo no máximo um.
    const semPrincipal = restantes.length > 0 && !restantes.some((d) => d.is_primary);
    this.selected.set(
      semPrincipal ? restantes.map((d, i) => ({ ...d, is_primary: i === 0 })) : restantes,
    );
  }

  protected marcarPrincipal(code: string): void {
    this.selected.set(this.selected().map((d) => ({ ...d, is_primary: d.code === code })));
  }
}
