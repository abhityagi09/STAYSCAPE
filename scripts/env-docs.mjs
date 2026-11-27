#!/usr/bin/env node
/**
 * Regenerates the variable table in docs/environment.md from the API's configuration schema
 * (apps/api/src/config/env.ts), so the reference cannot drift from the code.
 *   node scripts/env-docs.mjs          rewrite the table between the markers
 *   node scripts/env-docs.mjs --check  exit 1 if the table is out of date (CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ts = createRequire(join(root, 'package.json'))('typescript');
const src = readFileSync(join(root, 'apps/api/src/config/env.ts'), 'utf8');
const sf = ts.createSourceFile('env.ts', src, ts.ScriptTarget.Latest, true);

const rows = [];
const visit = (node) => {
  if (
    ts.isPropertyAssignment(node) &&
    ts.isIdentifier(node.name) &&
    /^[A-Z][A-Z0-9_]+$/.test(node.name.text) &&
    node.parent &&
    ts.isObjectLiteralExpression(node.parent)
  ) {
    const text = node.initializer.getText(sf).replace(/\s+/g, ' ');
    // Project helpers: bool(x) defaults to x; csv defaults to an empty list.
    const def =
      /^bool\((true|false)\)$/.exec(text)?.[1] ??
      (text === 'csv' ? '(empty list)' : undefined) ??
      /\.default\(([^)]*(?:\([^)]*\))?[^)]*)\)/.exec(text)?.[1]?.trim();
    const optional = /optional|optionalString/.test(text);
    const comments = (ts.getLeadingCommentRanges(src, node.getFullStart()) ?? [])
      .map((r) => src.slice(r.pos, r.end))
      .join(' ')
      .replace(/\/\*\*|\*\/|\/\/|^\s*\*/gm, '')
      .replace(/\s*\*\s/g, ' ')
      // Drop section-divider comments such as "---- Finance (Phase 4)".
      .replace(/-{3,}\s[^.]*?\)\.?\s*/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\/\s*$/, '')
      .trim();
    rows.push({
      name: node.name.text,
      requirement: def !== undefined ? 'optional' : optional ? 'optional' : 'required',
      def: def === undefined ? '—' : `\`${def.replace(/\|/g, '\\|')}\``,
      note: comments.replace(/\|/g, '\\|'),
    });
  }
  ts.forEachChild(node, visit);
};
visit(sf);

const table = [
  `${rows.length} variables, generated from \`apps/api/src/config/env.ts\` by \`node scripts/env-docs.mjs\`.`,
  '',
  '| Variable | Required | Default | Notes |',
  '| --- | --- | --- | --- |',
  ...rows.map((r) => `| \`${r.name}\` | ${r.requirement} | ${r.def} | ${r.note} |`),
].join('\n');

const file = join(root, 'docs/environment.md');
const doc = readFileSync(file, 'utf8');
const start = '<!-- env-table:start -->';
const end = '<!-- env-table:end -->';
const next = doc.replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n\n${table}\n\n${end}`);
if (process.argv.includes('--check')) {
  if (next !== doc) {
    console.error('docs/environment.md is out of date: run node scripts/env-docs.mjs');
    process.exit(1);
  }
  console.log('docs/environment.md is up to date');
} else {
  writeFileSync(file, next);
  console.log(`docs/environment.md: ${rows.length} variables`);
}
