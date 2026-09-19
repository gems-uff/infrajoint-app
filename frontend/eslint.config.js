// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // As features soltas da seção Análise — "Mapa Corporal + CDAI/DAS28" e
    // "Analisador de Imagens" — existem para qualquer um experimentar e NÃO
    // persistem nada. Só o fluxo de Análise Térmica grava, atrelando a um
    // paciente.
    //
    // A regra abaixo é o que torna isso estrutural em vez de combinado: pegar o
    // dado exigiria importar a camada de dados ou o HttpClient, e as duas coisas
    // param o lint aqui. `thermal-analysis/` fica de fora da lista de propósito —
    // é lá que a persistência mora.
    files: [
      'src/app/features/analysis/body-map/**/*.ts',
      'src/app/features/analysis/image-analyzer/**/*.ts',
      'src/app/features/analysis/pages/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/patients/data/**'],
              message:
                'Feature independente não persiste: a gravação pertence ao fluxo de Análise Térmica (features/analysis/thermal-analysis/).',
            },
            {
              group: ['@angular/common/http'],
              message:
                'Feature independente não fala com a API: a gravação pertence ao fluxo de Análise Térmica.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
