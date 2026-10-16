import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

// eslint-config-next declares browser and Node globals for every file; these
// blocks turn them off so worklet and DSP code see only their own environment.
const nextGlobals = nextVitals.reduce((all, c) => ({ ...all, ...c.languageOptions?.globals }), {});
const allOff = Object.fromEntries(Object.keys(nextGlobals).map((name) => [name, 'off']));

const DSP_RULE = 'src/dsp is environment-independent (a3-audio-implementation.md, File layout).';

const config = [
  {
    ignores: [
      '.claude/**',
      '.next/**',
      '.tools/**',
      'node_modules/**',
      'out/**',
      'playwright-report/**',
      'public/worklets/**',
      'test-results/**',
    ],
  },
  ...nextVitals,

  // App code runs in the browser.
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/dsp/**', 'src/worklet/**'],
    languageOptions: { globals: globals.browser },
  },

  // Worklet modules run in AudioWorkletGlobalScope only.
  {
    files: ['src/worklet/**/*.js'],
    languageOptions: { globals: { ...allOff, ...globals.audioWorklet } },
  },

  // DSP modules: no host globals, no nondeterminism, imports only from src/dsp.
  {
    files: ['src/dsp/**/*.js'],
    languageOptions: { globals: allOff },
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'self', 'globalThis', 'AudioContext', 'performance', 'Date', 'console'].map(
          (name) => ({ name, message: DSP_RULE }),
        ),
      ],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: DSP_RULE }],
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^[^.]', message: DSP_RULE }, { regex: '^\\.(?!.*\\.js$)', message: 'Relative imports include the .js extension.' }] },
      ],
    },
  },

  // The render quantum is read from each process() call, never assumed.
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/dsp/core/constants.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=128]', message: 'Use a named constant from src/dsp/core/constants.js.' },
      ],
    },
  },

  // Undeclared globals are errors, so each block's globals define its environment.
  // Errors are shown or rethrown, never swallowed.
  {
    rules: {
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  // Build scripts, config files and unit tests run in Node.
  {
    files: ['scripts/**/*.mjs', 'tests/dsp/**/*.js', '*.config.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Playwright specs run in Node and pass callbacks to the browser.
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];

export default config;
