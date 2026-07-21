import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // 占位 test/stories 文件（telemetry-farm-observability P0-7）import 尚未接入的
    // vitest/@testing-library/@storybook，需顶部 `@ts-nocheck` 以免拖垮 tsc/build；
    // 这些文件仅关掉 ban-ts-comment（接入测试运行时后删掉 @ts-nocheck 即自然恢复）。
    files: ['**/*.{test,stories}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
);
