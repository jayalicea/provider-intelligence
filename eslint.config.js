const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'client/**',
      'coverage/**',
      'dist/**',
      'provider-intelligence/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // ESLint 9 changed the default to 'all'; keep 8's behavior so unused
      // `catch (e)` bindings in the tools scripts are not errors.
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
