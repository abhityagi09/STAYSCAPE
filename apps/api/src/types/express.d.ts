import type { Role } from '@stayscape/shared';
import type { UserRecord } from '@/modules/users/user.model';

export interface AuthContext {
  userId: string;
  roles: Role[];
  /** Refresh-token family of the session that issued the access token. */
  sessionId: string;
  user: UserRecord;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      validatedQuery?: unknown;
      validatedParams?: unknown;
    }
  }
}

export {};
