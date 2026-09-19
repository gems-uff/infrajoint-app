import { TestBed } from '@angular/core/testing';

import { appConfig } from '../../../../app.config';
import { ImageAnalyzerPage } from './image-analyzer-page';

/**
 * Guarda de regressão da tela solta.
 *
 * A Fase 5 mexeu nesta página — expôs signais, passou a reter os arquivos de origem
 * e trocou a raiz de `<main>` para `<div>` com `role` condicional. Nada disso pode
 * ter quebrado a tela que qualquer um usa para experimentar.
 */
describe('ImageAnalyzerPage', () => {
  it('monta e renderiza como página independente', async () => {
    // Reusa os providers da aplicação: sem eles os ícones Lucide não resolvem, e o
    // teste falharia por ambiente, não por regressão.
    await TestBed.configureTestingModule({
      imports: [ImageAnalyzerPage],
      providers: [...appConfig.providers],
    }).compileComponents();

    const fixture = TestBed.createComponent(ImageAnalyzerPage);
    fixture.detectChanges();

    const raiz = fixture.nativeElement.querySelector('div.text-ink-strong');
    expect(raiz).toBeTruthy();
    // Sem `embedded`, a página continua sendo o marco principal para leitor de tela.
    expect(raiz.getAttribute('role')).toBe('main');
  });

  it('embutida no fluxo, abre mão do papel de main', async () => {
    // Reusa os providers da aplicação: sem eles os ícones Lucide não resolvem, e o
    // teste falharia por ambiente, não por regressão.
    await TestBed.configureTestingModule({
      imports: [ImageAnalyzerPage],
      providers: [...appConfig.providers],
    }).compileComponents();

    const fixture = TestBed.createComponent(ImageAnalyzerPage);
    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();

    // <main> dentro de <main> é HTML inválido e atrapalha leitor de tela.
    const raiz = fixture.nativeElement.querySelector('div.text-ink-strong');
    expect(raiz.getAttribute('role')).toBeNull();
  });

  it('começa sem arquivo de origem retido', () => {
    const fixture = TestBed.createComponent(ImageAnalyzerPage);
    const page = fixture.componentInstance;

    expect(page.rgbFile()).toBeNull();
    expect(page.csvFile()).toBeNull();
    expect(page.jpegFile()).toBeNull();
  });
});
