#!/usr/bin/env node
/**
 * Pre-flight check for local development. Reports which required variables are missing
 * from .env (names only — values are never printed) and whether local services respond.
 *
 *   npm run check:env
 */
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const required = ['MONGO_URI', 'REDIS_URL', 'JWT_ACCESS_SECRET', 'WEB_APP_URL'];

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function probe(host, port) {
  return new Promise((done) => {
    const socket = createConnection({ host, port, timeout: 1500 });
    socket.once('connect', () => {
      socket.end();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

let failed = false;
if (!existsSync(envPath)) {
  console.error('✗ .env not found. Create it with:  cp .env.example .env');
  process.exit(1);
}
const env = { ...parseEnv(readFileSync(envPath, 'utf8')), ...process.env };
for (const name of required) {
  if (!env[name]) {
    console.error(`✗ ${name} is not set`);
    failed = true;
  } else console.log(`✓ ${name} is set`);
}
if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET.length < 32) {
  console.error('✗ JWT_ACCESS_SECRET must be at least 32 characters');
  failed = true;
}

const services = [
  ['MongoDB', 'localhost', 27017],
  ['Redis', 'localhost', 6379],
  ['Mailpit SMTP', 'localhost', 1025],
];
for (const [name, host, port] of services) {
  const up = await probe(host, port);
  console.log(`${up ? '✓' : '✗'} ${name} ${up ? 'reachable' : 'not reachable'} on ${host}:${port}`);
  if (!up) failed = true;
}
if (failed) console.error('\nStart local services with:  npm run services:up');
process.exit(failed ? 1 : 0);
