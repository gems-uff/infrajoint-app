import { moduloPdfMake } from './encounter-report.service';

/**
 * O empacotador decide a forma do módulo, e ela difere entre os dois ambientes.
 *
 * Este teste existe por causa de uma falha real: o código acessava os exports
 * nomeados direto, o Node os sintetizava e os testes passavam — enquanto o chunk do
 * navegador terminava em `export default` e o botão quebrava com `undefined is not a
 * function`. As duas formas precisam ser exercitadas aqui, porque só uma delas
 * aparece quando os testes rodam.
 */
describe('moduloPdfMake', () => {
  const funcoes = { createPdf: () => null, addVirtualFileSystem: () => undefined };

  it('aceita a forma do Node, com os nomeados sintetizados', () => {
    // O objeto de fora ganha, porque já tem `createPdf` — descer para o `default`
    // aqui seria alcançar o mesmo módulo por um caminho mais longo.
    const namespace = { ...funcoes, default: funcoes };
    expect(moduloPdfMake(namespace)).toBe(namespace);
  });

  it('aceita a forma do navegador, só com default', () => {
    expect(moduloPdfMake({ default: funcoes })).toBe(funcoes);
  });
});
