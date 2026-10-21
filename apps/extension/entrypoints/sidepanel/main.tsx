import { createRoot } from "react-dom/client";
import "~/assets/tailwind.css";
import { SidePanelApp } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("No se encontró #root");

createRoot(container).render(<SidePanelApp />);
