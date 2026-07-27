import { TypeFetchProvider } from "@tahanabavi/typefetch-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createStack } from "../../shared/stack.js";
import { App } from "./App.js";
import "./styles.css";

// The same `createStack()` the headless run uses — the UI demonstrates the
// wiring, it does not re-declare it.
const stack = createStack();

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

createRoot(container).render(
  <StrictMode>
    <TypeFetchProvider client={stack.client}>
      <App stack={stack} />
    </TypeFetchProvider>
  </StrictMode>,
);
