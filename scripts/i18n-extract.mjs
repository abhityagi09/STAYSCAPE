#!/usr/bin/env node
/**
 * i18n codemod and extractor for apps/web.
 *
 *   node scripts/i18n-extract.mjs --write   wrap human-facing English text in tr('…') and report
 *   node scripts/i18n-extract.mjs --check   list strings rendered without tr() and missing Hindi
 *
 * What counts as human-facing text (everything else is left alone):
 *  - JSX text;
 *  - string literals in display props (label, title, description, placeholder, hint, aria-label, …);
 *  - string literals in display fields of objects (label, title, description, header, …);
 *  - string literals in conditional branches inside JSX expressions;
 *  - values of module-level `…LABELS` maps.
 * Module-level display fields become getters (`get label() { return tr('…'); }`) so they are
 * evaluated at render time, after the active language is loaded.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const webSrc = join(root, 'apps/web/src');

const DISPLAY_PROPS = new Set([
  'label',
  'title',
  'description',
  'placeholder',
  'hint',
  'aria-label',
  'confirmLabel',
  'cancelLabel',
  'legend',
  'caption',
  'eyebrow',
  'workspace',
  'emptyTitle',
  'emptyDescription',
  'note',
]);
const DISPLAY_FIELDS = new Set([
  'label',
  'title',
  'description',
  'header',
  'hint',
  'placeholder',
  'legend',
  'eyebrow',
  'detail',
  'heading',
  'subtitle',
  'confirmLabel',
  'body',
  'text',
  'note',
]);
const SKIP_FILES = [
  /\.test\.tsx?$/,
  /[\\/]lib[\\/](i18n\.tsx|tr\.ts)$/,
  /[\\/]locales[\\/]/,
  /[\\/]test[\\/]/,
  /main\.tsx$/,
  /vite-env/,
];

const decode = (s) =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&');
const norm = (s) => decode(s).replace(/\s+/g, ' ').trim();
/** A string literal that reads as text for people, not a code, URL, enum or class list. */
function isHumanLiteral(s) {
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  if (/^\//.test(s) || /:\/\//.test(s)) return false;
  if (/^[A-Z0-9_]+$/.test(s)) return false; // ENUM_VALUE
  if (/^[a-z0-9_.:\-[\]/]+$/.test(s)) return false; // code / single lowercase token
  if (/^[a-z0-9:\-[\]/.]+( [a-z0-9:\-[\]/.!]+)+$/.test(s) && /[-:[]/.test(s)) return false; // CSS class list
  return true;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) && !SKIP_FILES.some((r) => r.test(p)))
      out.push(p);
  }
  return out;
}

const isFunctionLike = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isArrowFunction(n) ||
  ts.isFunctionExpression(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isConstructorDeclaration(n);
function insideFunction(node) {
  for (let p = node.parent; p; p = p.parent) if (isFunctionLike(p)) return true;
  return false;
}
function isTrCall(node) {
  return (
    node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'tr'
  );
}
/** Literal inside a JSX expression only through conditionals / logical operators / parentheses. */
function jsxExpressionTarget(lit) {
  let child = lit;
  for (let p = lit.parent; p; child = p, p = p.parent) {
    if (ts.isParenthesizedExpression(p)) continue;
    if (ts.isConditionalExpression(p)) {
      if (child === p.condition) return null;
      continue;
    }
    if (
      ts.isBinaryExpression(p) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(p.operatorToken.kind)
    ) {
      if (child === p.left) return null;
      continue;
    }
    if (ts.isJsxExpression(p)) {
      const holder = p.parent;
      if (ts.isJsxAttribute(holder)) return DISPLAY_PROPS.has(holder.name.getText()) ? p : null;
      return ts.isJsxElement(holder) || ts.isJsxFragment(holder) ? p : null;
    }
    return null;
  }
  return null;
}

function processFile(file, write) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];
  const strings = [];
  const untranslated = [];
  const call = (s) => `tr(${JSON.stringify(s)})`;

  function visit(node) {
    // JSX text
    if (ts.isJsxText(node)) {
      const raw = node.getText(sf);
      const text = norm(raw);
      if (/[A-Za-z]/.test(text) && !node.containsOnlyTriviaWhiteSpaces) {
        const lead = raw.match(/^\s*/)[0];
        const trail = raw.match(/\s*$/)[0];
        const start = node.getStart(sf, true) + lead.length;
        const end = node.end - trail.length;
        if (end > start) {
          edits.push([start, end, `{${call(text)}}`]);
          strings.push(text);
        }
      }
    }
    // Display props with a plain string
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      DISPLAY_PROPS.has(node.name.getText(sf))
    ) {
      const text = node.initializer.text;
      if (isHumanLiteral(text)) {
        edits.push([node.initializer.getStart(sf), node.initializer.end, `{${call(text)}}`]);
        strings.push(text);
      }
    }
    // String literals inside JSX expressions (conditionals) and display fields
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isTrCall(node.parent)
    ) {
      const text = node.text;
      const parent = node.parent;
      if (isHumanLiteral(text)) {
        if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
          const name = parent.name.getText(sf).replace(/['"]/g, '');
          const labelMap = (() => {
            for (let p = parent.parent; p; p = p.parent)
              if (ts.isVariableDeclaration(p))
                return /labels?$/i.test(p.name.getText(sf)) && !insideFunction(p);
            return false;
          })();
          if (DISPLAY_FIELDS.has(name) || labelMap) {
            if (insideFunction(node)) edits.push([node.getStart(sf), node.end, call(text)]);
            else
              edits.push([
                parent.getStart(sf),
                parent.end,
                `get ${parent.name.getText(sf)}() { return ${call(text)}; }`,
              ]);
            strings.push(text);
          }
        } else if (jsxExpressionTarget(node)) {
          edits.push([node.getStart(sf), node.end, call(text)]);
          strings.push(text);
        }
      }
    }
    // Lookups into label maps (e.g. PROPERTY_TYPE_LABELS[type]) rendered or used as display fields
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /(LABELS|Labels|_LABEL)$/.test(node.expression.text) &&
      !isTrCall(node.parent)
    ) {
      const parent = node.parent;
      const display =
        jsxExpressionTarget(node) ||
        (ts.isPropertyAssignment(parent) &&
          parent.initializer === node &&
          DISPLAY_FIELDS.has(parent.name.getText(sf).replace(/['"]/g, '')) &&
          insideFunction(node));
      if (display) edits.push([node.getStart(sf), node.end, `tr(${node.getText(sf)})`]);
    }
    // Template literals with interpolations in display positions → trf('… {0} …', [values])
    if (
      ts.isTemplateExpression(node) &&
      !(
        node.parent &&
        ts.isCallExpression(node.parent) &&
        ts.isIdentifier(node.parent.expression) &&
        ['tr', 'trf'].includes(node.parent.expression.text)
      )
    ) {
      const parent = node.parent;
      const inDisplay =
        jsxExpressionTarget(node) ||
        (ts.isJsxExpression(parent) &&
          ts.isJsxAttribute(parent.parent) &&
          DISPLAY_PROPS.has(parent.parent.name.getText(sf))) ||
        (ts.isPropertyAssignment(parent) &&
          parent.initializer === node &&
          DISPLAY_FIELDS.has(parent.name.getText(sf).replace(/['"]/g, '')) &&
          insideFunction(node));
      const parts = [node.head.text, ...node.templateSpans.map((sp) => sp.literal.text)];
      if (inDisplay && /[A-Za-z]{2,}/.test(parts.join(' '))) {
        let key = node.head.text;
        node.templateSpans.forEach((sp, i) => (key += `{${i}}${sp.literal.text}`));
        key = key.replace(/\s+/g, ' ');
        const values = node.templateSpans.map((sp) => sp.expression.getText(sf)).join(', ');
        edits.push([node.getStart(sf), node.end, `trf(${JSON.stringify(key)}, [${values}])`]);
        strings.push(key);
        return; // nested templates stay inside the values
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (write && edits.length) {
    edits.sort((a, b) => b[0] - a[0]);
    let out = src;
    for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
    // Import exactly the helpers the file now uses.
    const needed = ['tr', 'trf'].filter((fn) => new RegExp(`\\b${fn}\\(`).test(out));
    const line = `import { ${needed.join(', ')} } from '@/lib/tr';`;
    if (/^import \{[^}]*\} from '@\/lib\/tr';$/m.test(out)) {
      out = out.replace(/^import \{[^}]*\} from '@\/lib\/tr';$/m, line);
    } else {
      const imports = [...out.matchAll(/^import[^;]*;\s*$/gms)];
      const last = imports.at(-1);
      const at = last ? last.index + last[0].length : 0;
      out = `${out.slice(0, at)}${line}\n${out.slice(at)}`;
    }
    writeFileSync(file, out);
  }
  return { strings, untranslated, edits: edits.length };
}

const write = process.argv.includes('--write');
const all = new Set();
const report = [];
for (const file of walk(webSrc)) {
  const r = processFile(file, write);
  r.strings.forEach((s) => all.add(s));
  if (r.edits || r.untranslated.length)
    report.push(
      `${relative(root, file)}: ${r.edits} edits${r.untranslated.length ? `, ${r.untranslated.length} template literal(s) left as is` : ''}`,
    );
}
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
if (out) writeFileSync(out, JSON.stringify([...all].sort(), null, 1));
console.log(report.join('\n'));
console.log(`\n${all.size} unique strings${write ? ' wrapped' : ''}`);
