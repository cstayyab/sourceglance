import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.es2021,
                // GJS / GNOME Shell globals
                console: 'readonly',
                global: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                print: 'readonly',
                printerr: 'readonly',
            },
        },
        rules: {
            // GNOME style keeps `GObject.registerClass(class Foo …)` bodies unindented.
            'indent': ['error', 4, {
                ignoredNodes: [
                    'CallExpression[callee.object.name=GObject][callee.property.name=registerClass] > ClassExpression:first-child',
                ],
            }],
            'quotes': ['error', 'single', {avoidEscape: true}],
            'semi': ['error', 'always'],
            'comma-dangle': ['error', 'always-multiline'],
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
        },
    },
];
