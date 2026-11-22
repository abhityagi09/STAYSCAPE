/**
 * The access token lives only in this module's memory — never in localStorage, sessionStorage,
 * Redux (which DevTools can inspect) or logs. A page reload drops it; the HttpOnly refresh
 * cookie is then used to obtain a new one.
 */
let accessToken: string | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (token: string) => {
    accessToken = token;
  },
  clear: () => {
    accessToken = null;
  },
};
