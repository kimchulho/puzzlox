import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TdsRoot } from "./TdsRoot";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TdsRoot>
      <App />
    </TdsRoot>
  </StrictMode>
);
