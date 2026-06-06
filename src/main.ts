import "./styles/main.css";
import "@phosphor-icons/web/regular";

import { WavefieldApp } from "./app";
import { logAttribution } from "./attribution";

logAttribution();

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

const app = new WavefieldApp(root);
app.start();

window.addEventListener("beforeunload", () => {
  app.dispose();
});
