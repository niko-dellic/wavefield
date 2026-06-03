import "./styles/main.css";
import "@phosphor-icons/web/regular";

import { WavefieldApp } from "./app";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

const app = new WavefieldApp(root);
app.start();

window.addEventListener("beforeunload", () => {
  app.dispose();
});
