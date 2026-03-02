import { createChannelHooks } from "@nativewindow/react";
import { schemas } from "../../src/schemas";

export const { ChannelProvider, useChannel, useChannelEvent, useSend } = createChannelHooks(
  schemas,
  {
    onValidationError: (type, payload) => {
      console.warn(`[Webview] Invalid "${type}" payload:`, payload);
    },
  },
);
