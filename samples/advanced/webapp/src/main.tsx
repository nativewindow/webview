import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ChannelProvider } from "./channel.ts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChannelProvider>
      <App />
    </ChannelProvider>
  </StrictMode>,
);
