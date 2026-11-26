#!/usr/bin/env tsx

/**
 * Add file extensions to relative imports in the emitted library declarations.
 * TypeScript keeps the extensionless specifiers from the source, and consumers
 * that use `moduleResolution: nodenext` cannot resolve them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/library/types');
const RELATIVE_SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|^import\s+)(['"])(\.{1,2}\/[^'"]+)\2/gm;

for (const entry of fs.readdirSync(TYPES, { recursive: true, encoding: 'utf8' })) {
  if (!entry.endsWith('.d.ts')) continue;
  const file = path.join(TYPES, entry);
  const source = fs.readFileSync(file, 'utf8');
  const fixed = source.replace(RELATIVE_SPECIFIER, (match, prefix: string, quote: string, specifier: string) => {
    if (specifier.endsWith('.js')) return match;
    const target = path.resolve(path.dirname(file), specifier);
    const suffix = ['', '/index'].find((candidate) => fs.existsSync(`${target}${candidate}.d.ts`));
    if (suffix === undefined) throw new Error(`${entry}: cannot resolve declaration import ${specifier}`);
    return `${prefix}${quote}${specifier}${suffix}.js${quote}`;
  });
  if (fixed !== source) fs.writeFileSync(file, fixed);
}
