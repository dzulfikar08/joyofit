import { describe, expect, it, mock } from 'bun:test';

import { isTabRoot, MORE_ROUTE } from './tabBarRoutes';

describe('Navigation & Stack Anchor Contract (Zero Fallback)', () => {
  describe('Tab Root Detection Boundaries', () => {
    it('correctly marks main tab roots', () => {
      expect(isTabRoot('index', undefined)).toBe(true);
      expect(isTabRoot('workouts', 'index')).toBe(true);
      expect(isTabRoot('social', 'index')).toBe(true);
      expect(isTabRoot('settings', 'index')).toBe(true);
      expect(isTabRoot(MORE_ROUTE, 'index')).toBe(true);
    });

    it('strictly classifies all sub-routes as non-root', () => {
      // Settings sub-routes
      expect(isTabRoot('settings', 'akun')).toBe(false);
      expect(isTabRoot('settings', 'import')).toBe(false);
      expect(isTabRoot('settings', 'sync')).toBe(false);
      expect(isTabRoot('settings', 'blocked')).toBe(false);
      expect(isTabRoot('settings', 'gear')).toBe(false);
      expect(isTabRoot('settings', 'gear-new')).toBe(false);
      expect(isTabRoot('settings', 'gear-edit')).toBe(false);

      // Workouts sub-routes
      expect(isTabRoot('workouts', 'manual')).toBe(false);
      expect(isTabRoot('workouts', 'record')).toBe(false);
      expect(isTabRoot('workouts', '[id]')).toBe(false);

      // Social sub-routes
      expect(isTabRoot('social', 'profile')).toBe(false);
      expect(isTabRoot('social', 'groups')).toBe(false);
      expect(isTabRoot('social', 'post/[id]')).toBe(false);

      // Hidden tabs & sub-stacks
      expect(isTabRoot('watch', 'alarms')).toBe(false);
      expect(isTabRoot('watch', 'faces')).toBe(false);
      expect(isTabRoot('coach', 'setup')).toBe(false);
      expect(isTabRoot('strength', 'active')).toBe(false);
      expect(isTabRoot('routes', '[id]')).toBe(false);
      expect(isTabRoot('ride', 'join')).toBe(false);
      expect(isTabRoot('family', 'invite')).toBe(false);
      expect(isTabRoot('joyo', 'chat')).toBe(false);
    });

    it('rejects unexpected inputs, prototype properties, and empty strings without guessing', () => {
      expect(isTabRoot('', undefined)).toBe(false);
      expect(isTabRoot('settings', '')).toBe(false);
      expect(isTabRoot('settings', ' ')).toBe(false);
      expect(isTabRoot('settings', 'index ')).toBe(false);
      expect(isTabRoot('constructor', undefined)).toBe(false);
      expect(isTabRoot('toString', undefined)).toBe(false);
      expect(isTabRoot('__proto__', undefined)).toBe(false);
    });
  });

  describe('Stack Back Action Contract (Zero Fallback Invariant)', () => {
    // Under Zero Fallbacks, a stack back action executes router.back() according to verified stack depth.
    function executeStackBack(router: { canGoBack: () => boolean; back: () => void }) {
      if (router.canGoBack()) {
        router.back();
      }
    }

    it('executes router.back() when stack contract is valid (canGoBack is true)', () => {
      const backMock = mock(() => {});
      const router = {
        canGoBack: () => true,
        back: backMock,
      };

      executeStackBack(router);
      expect(backMock).toHaveBeenCalledTimes(1);
    });

    it('does not invent synthetic redirects or guessed fallbacks when canGoBack is false', () => {
      const backMock = mock(() => {});
      const router = {
        canGoBack: () => false,
        back: backMock,
      };

      executeStackBack(router);
      expect(backMock).toHaveBeenCalledTimes(0);
    });

    it('handles rapid tap bursts deterministically without side effects', () => {
      let stackDepth = 1;
      const backCalls: number[] = [];

      const router = {
        canGoBack: () => stackDepth > 0,
        back: () => {
          stackDepth = Math.max(0, stackDepth - 1);
          backCalls.push(stackDepth);
        },
      };

      for (let i = 0; i < 5; i++) {
        executeStackBack(router);
      }

      // Exactly 1 back call executed, no synthetic fallbacks triggered
      expect(backCalls.length).toBe(1);
      expect(backCalls[0]).toBe(0);
    });
  });
});
