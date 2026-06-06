import {
  KEYBIND_STORAGE_KEY,
  assignKeyBinding,
  buildKeyCommands,
  clearKeyBinding,
  coerceKeyBindings,
  createTemplateApplyCommandId,
  getCommandForKey,
  getKeyboardEventCode,
  type KeyBindingMap,
  type KeyCommand,
  type KeyCommandId,
} from "../keybindings";
import { saveJsonToLocalStorage } from "../storage";
import {
  cloneTemplateSettings,
  coerceWavefieldTemplate,
  getCycledTemplateIndex,
  sortWavefieldTemplates,
  type WavefieldTemplate,
} from "../templateSettings";
import {
  TEMPLATE_TRANSITION_STORAGE_KEY,
  coerceTemplateTransitionConfig,
  type TemplateTransitionConfig,
} from "../templateTransition";
import type { EffectiveCymaticSettings } from "../types";

export type TemplateControllerOptions = {
  templates: WavefieldTemplate[];
  transitionConfig: TemplateTransitionConfig;
  keyBindings: KeyBindingMap;
  onApplyTemplate: (template: WavefieldTemplate) => void;
  onTransitionConfigChange: (config: TemplateTransitionConfig) => void;
  onStatus: (message: string) => void;
  getCurrentSettings: () => EffectiveCymaticSettings;
  refreshControls: () => void;
};

export class TemplateController {
  readonly templates: WavefieldTemplate[];
  readonly saveState = { name: "" };

  transitionConfig: TemplateTransitionConfig;
  keyCommands: KeyCommand[];
  keyBindings: KeyBindingMap;
  capturingKeybindSlug: string | null = null;
  activeTemplateSlug: string | null = null;

  constructor(private readonly options: TemplateControllerOptions) {
    this.templates = [...options.templates];
    this.transitionConfig = options.transitionConfig;
    this.keyCommands = buildKeyCommands(this.templates);
    this.keyBindings = options.keyBindings;
  }

  getControlsOptions() {
    return {
      isDev: import.meta.env.DEV,
      saveState: this.saveState,
      transitionConfig: this.transitionConfig,
      keyBindings: this.keyBindings,
      capturingKeybindSlug: this.capturingKeybindSlug,
      activeTemplateSlug: this.activeTemplateSlug,
      templates: this.templates,
      onApplyTemplate: (template: WavefieldTemplate) => {
        this.applyTemplate(template);
      },
      onDeleteTemplate: (template: WavefieldTemplate) => {
        void this.deleteTemplate(template);
      },
      onResaveTemplate: (template: WavefieldTemplate) => {
        void this.resaveTemplate(template);
      },
      onSaveTemplate: (name: string) => {
        void this.saveTemplate(name);
      },
      onStartTemplateKeyCapture: (template: WavefieldTemplate) => {
        this.startTemplateKeyCapture(template);
      },
      onTransitionConfigChange: (config: TemplateTransitionConfig) => {
        this.setTransitionConfig(config);
      },
    };
  }

  getCommandForKeyboardEvent(event: KeyboardEvent) {
    const keyCode = getKeyboardEventCode(event);
    return getCommandForKey(this.keyCommands, this.keyBindings, keyCode);
  }

  applyTemplate(template: WavefieldTemplate) {
    this.activeTemplateSlug = template.slug;
    this.options.onStatus(`Template: ${template.name}`);
    this.options.onApplyTemplate(template);
  }

  cycleTemplate(direction: -1 | 1) {
    if (this.templates.length === 0) {
      return;
    }

    const nextIndex = getCycledTemplateIndex(
      this.templates,
      this.activeTemplateSlug,
      direction,
    );
    if (nextIndex >= 0) {
      this.applyTemplate(this.templates[nextIndex]);
    }
  }

  startTemplateKeyCapture(template: WavefieldTemplate) {
    this.capturingKeybindSlug = template.slug;
    this.options.refreshControls();
    this.options.onStatus(`Press a key for ${template.name}`);
  }

  handleTemplateKeyCapture(event: KeyboardEvent) {
    event.preventDefault();
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const slug = this.capturingKeybindSlug;
    if (!slug) {
      return;
    }

    const keyCode = getKeyboardEventCode(event);

    if (keyCode === "Escape") {
      this.capturingKeybindSlug = null;
      this.options.refreshControls();
      return;
    }

    const commandId = createTemplateApplyCommandId(slug);
    if (keyCode === "Backspace" || keyCode === "Delete") {
      this.setKeyBindings(clearKeyBinding(this.keyBindings, commandId));
      this.capturingKeybindSlug = null;
      this.options.refreshControls();
      return;
    }

    const assignment = assignKeyBinding(
      this.keyCommands,
      this.keyBindings,
      commandId,
      keyCode,
    );
    if (!assignment.ok) {
      this.options.onStatus(`Key already used by ${assignment.conflictLabel}`);
      return;
    }

    this.setKeyBindings(assignment.bindings);
    this.capturingKeybindSlug = null;
    this.options.refreshControls();
  }

  setTransitionConfig(config: TemplateTransitionConfig) {
    this.transitionConfig = coerceTemplateTransitionConfig(config);
    saveJsonToLocalStorage(
      TEMPLATE_TRANSITION_STORAGE_KEY,
      this.transitionConfig,
    );
    this.options.onTransitionConfigChange(this.transitionConfig);
    this.options.refreshControls();
  }

  clearActiveTemplate() {
    this.activeTemplateSlug = null;
  }

  async saveTemplate(name: string) {
    const template = await this.writeTemplate(name);
    if (!template) {
      return;
    }

    this.saveState.name = "";
    this.options.onStatus(`Saved template: ${template.name}`);
  }

  async resaveTemplate(template: WavefieldTemplate) {
    const nextTemplate = await this.writeTemplate(template.name);
    if (!nextTemplate) {
      return;
    }

    this.options.onStatus(`Resaved template: ${nextTemplate.name}`);
  }

  async deleteTemplate(template: WavefieldTemplate) {
    if (!import.meta.env.DEV) {
      return;
    }

    const response = await fetch(
      `/api/templates/${encodeURIComponent(template.slug)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(await readTemplateApiError(response));
    }

    this.setTemplates(
      this.templates.filter((candidate) => candidate.slug !== template.slug),
    );
    this.options.onStatus(`Deleted template: ${template.name}`);
  }

  runApplyCommand(commandId: KeyCommandId) {
    if (!commandId.startsWith("template.apply.")) {
      return false;
    }

    const slug = commandId.slice("template.apply.".length);
    const template = this.templates.find(
      (candidate) => candidate.slug === slug,
    );
    if (template) {
      this.applyTemplate(template);
    }
    return true;
  }

  private async writeTemplate(name: string) {
    if (!import.meta.env.DEV) {
      return null;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return null;
    }

    const response = await fetch("/api/templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: trimmedName,
        settings: cloneTemplateSettings(this.options.getCurrentSettings()),
      }),
    });

    if (!response.ok) {
      throw new Error(await readTemplateApiError(response));
    }

    const body = (await response.json()) as { template?: unknown };
    const template = coerceWavefieldTemplate(body.template, "template");
    this.upsertTemplate(template);
    return template;
  }

  private upsertTemplate(template: WavefieldTemplate) {
    this.setTemplates([
      ...this.templates.filter((candidate) => candidate.slug !== template.slug),
      template,
    ]);
  }

  private setTemplates(templates: WavefieldTemplate[]) {
    this.templates.splice(
      0,
      this.templates.length,
      ...sortWavefieldTemplates(templates),
    );
    this.keyCommands = buildKeyCommands(this.templates);
    this.setKeyBindings(coerceKeyBindings(this.keyBindings, this.keyCommands));
    if (
      this.activeTemplateSlug &&
      !this.templates.some(
        (template) => template.slug === this.activeTemplateSlug,
      )
    ) {
      this.activeTemplateSlug = null;
    }
    this.options.refreshControls();
  }

  private setKeyBindings(bindings: KeyBindingMap) {
    this.keyBindings = bindings;
    saveJsonToLocalStorage(KEYBIND_STORAGE_KEY, this.keyBindings);
  }
}

export function loadTemplateKeyBindings(templates: WavefieldTemplate[]) {
  const commands = buildKeyCommands(templates);
  try {
    const rawValue = window.localStorage.getItem(KEYBIND_STORAGE_KEY);
    return coerceKeyBindings(rawValue ? JSON.parse(rawValue) : {}, commands);
  } catch {
    return coerceKeyBindings({}, commands);
  }
}

async function readTemplateApiError(response: Response) {
  const fallback = `Template request failed (${response.status})`;
  const text = await response.text();
  if (!text.trim()) {
    return fallback;
  }

  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return text;
  }
}
