import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
    rules: {
      // owlog-api tourne sous `node --experimental-strip-types` : Node retire
      // les annotations de type sans jamais compiler. Toute syntaxe TypeScript
      // qui *produit* du code au lieu d'annoter fait donc échouer le
      // démarrage, en production seulement — `tsx` et Vitest, eux, compilent
      // et ne signalent rien. C'est une panne au lancement, silencieuse en
      // développement, trouvée une fois de trop à la main.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSParameterProperty',
          message:
            'Parameter properties emit code and break `node --experimental-strip-types`. Declare the field, then assign it in the constructor body.',
        },
        {
          selector: 'TSEnumDeclaration',
          message:
            'Enums emit code and break `node --experimental-strip-types`. Use a union of string literals plus a frozen lookup object.',
        },
        {
          selector: 'TSModuleDeclaration',
          message:
            'Namespaces emit code and break `node --experimental-strip-types`. Use modules.',
        },
      ],
      'no-warning-comments': [
        'error',
        { terms: ['todo', 'fixme', 'xxx'], location: 'anywhere' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
