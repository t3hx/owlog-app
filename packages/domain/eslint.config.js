import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Règles de lint du domaine.
 *
 * Même politique que le reste du dépôt : « pas de code mort » appliqué par
 * le lint, pas par une étape de build. S'y ajoute la garde hexagonale sous
 * sa forme la plus stricte — le domaine ne connaît AUCUNE infrastructure,
 * donc aucun import hors du package (vitest excepté, pour les tests).
 */
export default tseslint.config(
  { ignores: ['coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
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
      // Le domaine ne connaît aucune infrastructure (architecture
      // hexagonale). La liste nomme les fuites déjà vues ou plausibles ;
      // le test `environment: 'node'` attrape le reste (tout accès DOM ou
      // IndexedDB y explose).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['dexie', 'dexie-react-hooks', 'react', 'react-dom'],
              message:
                'Le domaine est hermétique : aucune infrastructure, aucun framework.',
            },
          ],
        },
      ],
    },
  },
)
