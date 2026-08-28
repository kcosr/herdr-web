import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VspaceFixture } from "./VspaceFixture";

const root = document.getElementById("root");
if (!root) throw new Error("no #root");
createRoot(root).render(
  <StrictMode>
    <VspaceFixture />
  </StrictMode>,
);
