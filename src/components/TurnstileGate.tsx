"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile widget.
 *
 * Rendered only when a site key is configured. A token is short-lived, so it is
 * requested close to submission and reset after every use rather than being
 * minted once at the start of a long quiz.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
      execute: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const turnstileSiteKey = () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;

export interface TurnstileHandle {
  /** Resolves with a fresh token, or null when verification is not configured. */
  getToken: () => Promise<string | null>;
  reset: () => void;
}

export function useTurnstile(action: string): { element: React.ReactNode; handle: TurnstileHandle } {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const pending = useRef<((token: string | null) => void) | null>(null);
  const [failed, setFailed] = useState(false);
  const siteKey = turnstileSiteKey();

  useEffect(() => {
    if (!siteKey || !container.current) return;

    let cancelled = false;

    function render() {
      if (cancelled || !window.turnstile || !container.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token: string) => {
          setFailed(false);
          pending.current?.(token);
          pending.current = null;
        },
        "expired-callback": () => window.turnstile?.reset(widgetId.current ?? undefined),
        "error-callback": () => {
          setFailed(true);
          pending.current?.(null);
          pending.current = null;
        },
      });
    }

    if (window.turnstile) {
      render();
    } else if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = render;
      script.onerror = () => setFailed(true);
      document.head.appendChild(script);
    } else {
      const timer = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(timer);
          render();
        }
      }, 200);
      return () => window.clearInterval(timer);
    }

    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!siteKey) return null;
    if (!window.turnstile || !widgetId.current) return null;

    window.turnstile.reset(widgetId.current);
    return new Promise<string | null>((resolve) => {
      pending.current = resolve;
      window.turnstile?.execute(widgetId.current ?? undefined);
      // Never block the person indefinitely on a challenge that stalls.
      window.setTimeout(() => {
        if (pending.current === resolve) {
          pending.current = null;
          resolve(null);
        }
      }, 15_000);
    });
  }, [siteKey]);

  const reset = useCallback(() => {
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  return {
    element: siteKey ? (
      <div>
        <div ref={container} />
        {failed && (
          <p role="alert" className="mt-2 text-sm text-rose">
            The verification check could not load. Check your connection and try again.
          </p>
        )}
      </div>
    ) : null,
    handle: { getToken, reset },
  };
}
