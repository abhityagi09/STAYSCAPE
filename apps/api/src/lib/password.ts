import argon2 from 'argon2';
import type { Config } from '@/config/env';

export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly config: Pick<Config, 'ARGON2_MEMORY_KIB' | 'ARGON2_TIME_COST'>) {}

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.config.ARGON2_MEMORY_KIB,
      timeCost: this.config.ARGON2_TIME_COST,
      parallelism: 1,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Verify against a throwaway hash so that "unknown email" and "wrong password"
   * take comparable time, reducing account enumeration via timing.
   */
  async verifyDummy(plain: string): Promise<false> {
    this.dummyHash ??= this.hash('stayscape-timing-equaliser');
    await this.verify(await this.dummyHash, plain);
    return false;
  }
}
