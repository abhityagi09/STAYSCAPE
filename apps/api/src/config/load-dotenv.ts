import { resolve } from 'node:path';
import dotenv from 'dotenv';

/**
 * Load `.env` from the API workspace first, then the repository root.
 * Variables already present in the process environment (e.g. from Docker) always win.
 */
export function loadDotenv(): void {
  dotenv.config({
    path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
    quiet: true,
  });
}
