// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * `no-restricted-syntax` selector for gate 1.1 ("no ad-hoc colors/spacing in
 * views"): flags string/template literals that look like a raw hex color
 * anywhere under apps/*\/src — those must come from `@genesis/tokens`
 * instead. Scoped out of packages/tokens (the one place hex values are
 * allowed to live) via the `ignores` block below.
 */
const noAdHocHexColor = {
  selector: "Literal[value=/^#([0-9a-fA-F]{3}){1,2}$/]",
  message: 'Ad-hoc hex color — import from @genesis/tokens (colors.*) instead (gate 1.1).',
};

// Files that are real app/library source and belong to a package's
// tsconfig `include` — these get full type-aware linting.
const TYPE_CHECKED_GLOBS = ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'];
const NON_PROJECT_GLOBS = [
  '**/*.config.{js,mjs,cjs,ts}',
  '**/scripts/**/*.{js,mjs,cjs}',
  '**/*.test.{ts,tsx}',
  '**/__tests__/**/*.{ts,tsx}',
  '**/e2e/**/*.{ts,tsx}',
];

export default tseslint.config(
  {
    ignores: ['**/.next/**', '**/dist/**', '**/node_modules/**', '**/generated/**', '**/*.css'],
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: TYPE_CHECKED_GLOBS,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
    {
    files: NON_PROJECT_GLOBS,
    ...tseslint.configs.disableTypeChecked,
  },
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Views/components may not hard-code design values (gate 1.1).
    files: ['apps/*/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', noAdHocHexColor],
    },
  },
  {
    // The design system itself owns the token values.
    files: ['packages/tokens/**/*.{ts,tsx,css}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
