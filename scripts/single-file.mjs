// Assemble dist/ en un seul fichier « Slice.html » à la racine du projet.
// Un navigateur refuse de charger des scripts modules séparés depuis file://,
// d'où l'intégration du JS et du CSS directement dans la page.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const output = join(root, 'Slice.html');

let html = readFileSync(join(dist, 'index.html'), 'utf8');
const read = (href) => readFileSync(join(dist, href.replace(/^\.?\//, '')), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`);

html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  // "</script" dans le code fermerait la balise trop tôt.
  const js = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});

if (/(src|href)="\.?\/?assets\//.test(html)) {
  throw new Error('Des fichiers de dist/assets ne sont pas intégrés : vérifier vite.config.ts.');
}

writeFileSync(output, html);
console.log(`✓ ${output} (${(Buffer.byteLength(html) / 1024).toFixed(0)} Ko)`);
