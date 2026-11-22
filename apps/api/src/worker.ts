import { bootstrap, handleShutdownSignals } from '@/bootstrap';

/**
 * Standalone background worker process. Use this in production with RUN_WORKERS=false on the
 * API instances so HTTP and job processing scale independently.
 */
async function main() {
  const runtime = await bootstrap({ startWorkers: true });
  runtime.logger.info('STAYSCAPE worker running');
  handleShutdownSignals(runtime.logger, runtime.shutdown);
}

main().catch((error: unknown) => {
  console.error('Worker failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
