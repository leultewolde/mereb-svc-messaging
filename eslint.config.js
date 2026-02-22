import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default compat.config({
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.eslint.json',
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'node_modules']
}, {
  files: ['src/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: 'fastify', message: 'Domain layer cannot import transport frameworks.' },
        { name: 'mercurius', message: 'Domain layer cannot import transport frameworks.' },
        { name: 'kafkajs', message: 'Domain layer cannot import Kafka clients.' },
        { name: '@mereb/shared-packages', message: 'Domain layer cannot import shared infrastructure clients.' }
      ],
      patterns: [
        { group: ['**/adapters/**'], message: 'Domain layer cannot import adapters.' },
        { group: ['**/prisma.js', '**/prisma'], message: 'Domain layer cannot import Prisma clients.' }
      ]
    }]
  }
}, {
  files: ['src/application/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: 'fastify', message: 'Application layer cannot import transport frameworks.' },
        { name: 'mercurius', message: 'Application layer cannot import transport frameworks.' },
        { name: 'kafkajs', message: 'Application layer cannot import Kafka clients.' }
      ],
      patterns: [
        { group: ['**/adapters/**'], message: 'Application layer cannot import adapters.' },
        { group: ['**/prisma.js', '**/prisma'], message: 'Application layer cannot import Prisma clients.' }
      ]
    }]
  }
});
