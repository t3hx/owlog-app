import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Règles de lint.
 *
 * La règle projet « pas de code mort » est appliquée ici plutôt que par une
 * étape de dépouillement au merge : `main` doit rester déboguable, avec des
 * numéros de ligne qui correspondent à ce qu'on lit en local.
 */
export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // Pas de code mort : un TODO orphelin ne passe pas la revue.
      'no-warning-comments': [
        'error',
        { terms: ['todo', 'fixme', 'xxx'], location: 'anywhere' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Le domaine ne connaît aucune infrastructure (architecture hexagonale).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['dexie', 'dexie-react-hooks'],
              message:
                'Le domaine et l\'UI ne parlent pas à Dexie directement. Passer par un port (adapters/dexie).',
            },
          ],
        },
      ],
    },
  },
  {
    // Les adaptateurs sont précisément la couche autorisée à parler à Dexie.
    files: ['src/adapters/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
)
