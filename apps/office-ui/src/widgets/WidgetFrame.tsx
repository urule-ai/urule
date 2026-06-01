"use client";

import { useEffect, useMemo, useRef, useCallback } from "react";
import type { WidgetRenderContext } from "./context";
import {
  isAllowedFromWidget,
  widgetSandbox,
  widgetTargetOrigin,
} from "./widget-frame-security";

interface WidgetFrameProps {
  context: WidgetRenderContext;
  entryUrl: string;
}

/**
 * Iframe wrapper for external widgets.
 * Sends init/theme/config messages via postMessage.
 *
 * Security (H-06 hardening — see widget-frame-security.ts):
 *   - postMessage targetOrigin is bound to the iframe's parsed origin
 *     (or `"null"` when sandbox excludes allow-same-origin), never `"*"`.
 *   - Inbound messages are filtered on `event.origin`, not just widgetId.
 *   - The sandbox attribute drops `allow-same-origin` for same-origin
 *     entries to prevent the iframe escaping into the parent.
 */
export function WidgetFrame({ context, entryUrl }: WidgetFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Resolved per-render against the live `window.location.origin`.
  // useMemo+entryUrl is sufficient — the host origin never changes within
  // a page load.
  const hostOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const targetOrigin = useMemo(
    () => widgetTargetOrigin(entryUrl, hostOrigin),
    [entryUrl, hostOrigin],
  );
  const sandbox = useMemo(
    () => widgetSandbox(entryUrl, hostOrigin),
    [entryUrl, hostOrigin],
  );

  const sendMessage = useCallback(
    (type: string, payload: unknown) => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type,
          widgetId: context.widgetId,
          payload,
          timestamp: Date.now(),
        },
        targetOrigin,
      );
    },
    [context.widgetId, targetOrigin],
  );

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Origin filter first — a same-page popup / third-party script
      // / another iframe must not be able to spoof widget messages
      // just by guessing the widgetId.
      if (!isAllowedFromWidget(event.origin, entryUrl, hostOrigin)) return;

      const data = event.data;
      if (!data || data.widgetId !== context.widgetId) return;

      switch (data.type) {
        case "widget:ready":
          sendMessage("widget:init", {
            widgetId: context.widgetId,
            manifestId: context.manifestId,
            workspaceId: context.workspaceId,
            config: context.config,
            theme: context.theme,
            permissions: context.permissions,
          });
          break;
        case "widget:resize":
          // Could resize the iframe container if needed
          break;
        case "widget:action":
          // Forward to parent or handle action
          break;
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [context, entryUrl, hostOrigin, sendMessage]);

  return (
    <iframe
      ref={iframeRef}
      src={entryUrl}
      className="w-full h-full border-0"
      sandbox={sandbox}
      title={context.manifestId}
    />
  );
}
