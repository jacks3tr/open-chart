import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const coreFiles = [
  'packages/connectors/**/*.ts',
  'packages/ir/**/*.ts',
  'packages/ops/**/*.ts',
  'packages/persistence/**/*.ts',
  'packages/agent/**/*.ts',
  'packages/render/**/*.ts',
  'packages/serialize/**/*.ts',
  'packages/derive/**/*.ts',
  'packages/scene/**/*.ts',
  'packages/shapes/**/*.ts',
  'packages/vendor-packs/**/*.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      '**/target/**',
      '**/coverage/**',
      'packages/shapes/generated/**',
      'scripts/run-render-benchmark.mjs',
      'eslint.config.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['scripts/**/*.mjs'],
  },
  {
    files: coreFiles,
    rules: {
      'no-restricted-globals': [
        'error',
        'document',
        'window',
        'HTMLElement',
        'HTMLCanvasElement',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react-dom',
            '@openchart/app',
            '@openchart/interact',
            '@openchart/render',
          ],
        },
      ],
    },
  },
);
