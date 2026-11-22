import { createServer } from 'node:http';
import { createApp } from '@/app';
import { bootstrap, handleShutdownSignals } from '@/bootstrap';
import { ConfigError } from '@/config/env';

async function main() {
  const runtime = await bootstrap();
  const { config, logger, container } = runtime;
  const app = createApp(container);
  const server = createServer(app);

  // Keep-alive slightly above typical load balancer idle timeouts.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  server.listen(config.PORT, config.HOST, () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      `STAYSCAPE API listening on ${config.API_PUBLIC_URL}`,
    );
  });

  handleShutdownSignals(logger, async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.shutdown();
  });

  process.on('unhandledRejection', (reason) =>
    logger.error({ err: reason }, 'Unhandled promise rejection'),
  );
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else console.error('API failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
