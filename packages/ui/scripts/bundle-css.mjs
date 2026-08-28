// Concatenates tokens.css + components.css into dist/styles.css (single import for apps).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const parts = ['src/tokens.css', 'src/components.css']
  .map((p) => join(root, p)).filter(existsSync).map((p) => readFileSync(p, 'utf8'));
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/styles.css'), parts.join('\n\n'));
console.log('wrote dist/styles.css');
