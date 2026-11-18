import { createRoot } from "react-dom/client";
import "~/assets/tailwind.css";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { ToastProvider } from "~/components/Toast";
import { SidePanelApp } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("No se encontró #root");

createRoot(container).render(
  <ErrorBoundary surface="sidepanel">
    <ToastProvider placement="bottom">
      <SidePanelApp />
    </ToastProvider>
  </ErrorBoundary>,
);
