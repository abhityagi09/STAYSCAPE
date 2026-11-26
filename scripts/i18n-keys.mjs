#!/usr/bin/env node
/**
 * Lists every translation key used by apps/web and checks the Hindi dictionary against it.
 *
 *   node scripts/i18n-keys.mjs              report keys missing from lib/locales/hi.ts (exit 1 if any)
 *   node scripts/i18n-keys.mjs --out=f.json write the full key list
 *
 * Keys are the literal arguments of tr()/trf(), plus the English values of label maps from
 * @stayscape/shared that are looked up through tr(MAP[key]).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const webSrc = join(root, 'apps/web/src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'locales' && name !== 'test') walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const keys = new Set();
const sharedMaps = new Set();
for (const file of walk(webSrc)) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imported = new Set();
  sf.statements.forEach((st) => {
    if (
      ts.isImportDeclaration(st) &&
      st.moduleSpecifier.text === '@stayscape/shared' &&
      st.importClause?.namedBindings &&
      ts.isNamedImports(st.importClause.namedBindings)
    )
      st.importClause.namedBindings.elements.forEach((e) => imported.add(e.name.text));
  });
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['tr', 'trf'].includes(node.expression.text)
    ) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)))
        keys.add(arg.text);
      else if (
        arg &&
        ts.isElementAccessExpression(arg) &&
        ts.isIdentifier(arg.expression) &&
        imported.has(arg.expression.text)
      )
        sharedMaps.add(arg.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const shared = await import(pathToFileURL(join(root, 'packages/shared/dist/index.js')).href);
for (const name of sharedMaps)
  for (const v of Object.values(shared[name] ?? {})) if (typeof v === 'string') keys.add(v);

const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const list = [...keys].sort();
if (out) writeFileSync(out, JSON.stringify(list, null, 1));

// Check the Hindi dictionary (parsed as data, not executed).
const hiSrc = readFileSync(join(webSrc, 'lib/locales/hi.ts'), 'utf8');
const hiSf = ts.createSourceFile('hi.ts', hiSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const have = new Set();
const visitHi = (node) => {
  if (
    ts.isPropertyAssignment(node) &&
    (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name))
  )
    have.add(node.name.text);
  ts.forEachChild(node, visitHi);
};
visitHi(hiSf);
const missing = list.filter((k) => !have.has(k));
const placeholderMismatch = [];
const values = new Map();
const collect = (node) => {
  if (
    ts.isPropertyAssignment(node) &&
    ts.isStringLiteral(node.initializer) &&
    (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name))
  )
    values.set(node.name.text, node.initializer.text);
  ts.forEachChild(node, collect);
};
collect(hiSf);
for (const [k, v] of values) {
  const used = new Set(v.match(/\{\d+\}/g) ?? []);
  const allowed = new Set(k.match(/\{\d+\}/g) ?? []);
  for (const p of used) if (!allowed.has(p)) placeholderMismatch.push(`${k} → uses ${p}`);
}
console.log(
  `${list.length} keys (${sharedMaps.size} shared label maps: ${[...sharedMaps].join(', ') || 'none'})`,
);
console.log(
  `${missing.length} missing from hi.ts, ${placeholderMismatch.length} placeholder errors`,
);
if (process.argv.includes('--list-missing')) missing.forEach((m) => console.log(JSON.stringify(m)));
placeholderMismatch.forEach((m) => console.log('placeholder:', m));
if (!out && (missing.length || placeholderMismatch.length)) process.exitCode = 1;
