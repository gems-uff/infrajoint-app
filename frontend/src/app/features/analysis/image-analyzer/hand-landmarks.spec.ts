import { sidesByPosition } from './hand-landmarks.service';

// A câmera fica de frente para o voluntário: quem aparece à esquerda do quadro é
// a mão direita dele. Os punhos reais ficam em x ≈ 0,13 e x ≈ 0,86 da largura.
const LARGURA = 1000;

describe('sidesByPosition', () => {
  it('nomeia pela posição no quadro, não pela ordem de detecção', () => {
    expect(sidesByPosition([130, 860], LARGURA)).toEqual(['Direita', 'Esquerda']);
    // O MediaPipe devolve as mãos em ordem variável; o resultado não pode mudar.
    expect(sidesByPosition([860, 130], LARGURA)).toEqual(['Esquerda', 'Direita']);
  });

  it('nunca dá o mesmo lado às duas mãos', () => {
    // O caso que quebrava a V054 Din05: o classificador rotulava as duas iguais.
    const sides = sidesByPosition([130, 860], LARGURA);
    expect(new Set(sides).size).toBe(2);
  });

  it('com uma mão só, decide pelo meio do quadro', () => {
    expect(sidesByPosition([130], LARGURA)).toEqual(['Direita']);
    expect(sidesByPosition([860], LARGURA)).toEqual(['Esquerda']);
  });

  it('sem mãos, não há lados', () => {
    expect(sidesByPosition([], LARGURA)).toEqual([]);
  });
});
