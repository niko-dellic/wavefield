import { MAX_MODAL_MODES } from "../../audio/ModalField";

import { COLOR_FRAGMENT } from "./fragmentColor";
import { FIELD_MODEL_FRAGMENT } from "./fragmentFieldModels";
import { MAIN_FRAGMENT } from "./fragmentMain";
import { SHARED_FRAGMENT } from "./fragmentShared";
import { SPHERE_FRAGMENT } from "./fragmentSphere";
import { TERMINAL_FRAGMENT } from "./fragmentTerminal";
import { VERTEX_SHADER } from "./vertexShader";

export { VERTEX_SHADER };

/** Assembled fragment shader for the modal field material. */
export const FRAGMENT_SHADER: string = `
  #define MAX_MODAL_MODES ${MAX_MODAL_MODES}${SHARED_FRAGMENT}${COLOR_FRAGMENT}${FIELD_MODEL_FRAGMENT}${SPHERE_FRAGMENT}${TERMINAL_FRAGMENT}${MAIN_FRAGMENT}`;
