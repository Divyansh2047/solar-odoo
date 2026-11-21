import { api, ApiError } from './api';

/**
 * Create a private demo workspace and sign in. If the server is still preparing the very first demo
 * (cold start), wait and retry, reporting progress through onWait.
 */
export async function startDemo(onWait?: (secondsLeft: number) => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await api.post('/api/auth/demo');
      return;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'demo_warming') {
        const wait = Number(e.data.retryIn ?? 8);
        for (let s = wait; s > 0; s--) {
          onWait?.(s);
          await new Promise((r) => setTimeout(r, 1000));
        }
        continue;
      }
      throw e;
    }
  }
  throw new ApiError(503, 'demo_unavailable', 'The demo is taking longer than usual. Try again in a minute.');
}

/** Demo copies keep emails unique with a hidden tag (vikram.mehta.d1a2b3c4@…); people see the plain address. */
export const shownEmail = (email: string | null | undefined, demo: boolean): string => (email && demo ? email.replace(/\.(d[0-9a-f]{8}|tpl)@/, '@') : (email ?? ''));

/** The workspace's own name, without the "(demo)" the ribbon already says. */
export const shownCompany = (name: string): string => name.replace(/\s*\(demo\)$/i, '');
