import { HttpErrorResponse } from '@angular/common/http';

import { Patient } from './patient.model';

/**
 * Converte a falha HTTP em uma frase para o usuário.
 *
 * O `detail` do backend é curto e em português; quando ele não vier, o status decide.
 * Nunca ecoamos corpo de erro desconhecido — a API já filtra detalhe interno, e repetir
 * o que chegou tornaria a tela refém disso.
 */
export function messageFromError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Não foi possível completar a operação.';
  }

  switch (error.status) {
    case 0:
      return 'Sem conexão com o servidor.';
    case 401:
      return 'Sua sessão expirou. Entre novamente.';
    case 403:
      return 'Seu perfil não permite esta ação.';
    case 404:
      return 'Registro não encontrado.';
    case 422:
      return 'Dados inválidos. Revise os campos.';
    default: {
      const detail = error.error?.detail;
      return typeof detail === 'string' && detail
        ? detail
        : 'Não foi possível completar a operação.';
    }
  }
}

/**
 * Os homônimos que o 409 da criação de paciente traz junto, ou `null`.
 *
 * Distingue as duas recusas que compartilham o status: "já existe alguém com este
 * nome, veja quem" — que a tela resolve oferecendo abrir o existente — de "nome e
 * data iguais", que vem só com a mensagem porque não há escolha a fazer.
 */
export function duplicatesFromError(error: unknown): readonly Patient[] | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }
  const duplicates = error.error?.duplicates;
  return Array.isArray(duplicates) && duplicates.length > 0 ? (duplicates as Patient[]) : null;
}
