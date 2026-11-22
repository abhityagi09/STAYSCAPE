import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
    'scripts/bootstrap-admin': 'src/scripts/bootstrap-admin.ts',
    'scripts/sync-indexes': 'src/scripts/sync-indexes.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: true,
  // Bundle the workspace package so the runtime image does not need its build output.
  noExternal: ['@stayscape/shared'],
});
