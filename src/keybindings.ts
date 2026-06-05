import type { WavefieldTemplate } from "./templateSettings.ts";

export type KeyCommandId =
  | "ui.settings"
  | "ui.fullscreen"
  | "audio.playback"
  | "boundary.freePlate"
  | "boundary.dirichlet"
  | "boundary.neumann"
  | "boundary.clamped"
  | "boundary.supported"
  | "template.previous"
  | "template.next"
  | `template.apply.${string}`;

export type KeyCommand = {
  id: KeyCommandId;
  label: string;
  defaultKey?: string;
  locked?: boolean;
};

export type KeyBindingMap = Partial<Record<KeyCommandId, string>>;

export type KeyBindAssignment =
  | {
      ok: true;
      bindings: KeyBindingMap;
    }
  | {
      ok: false;
      conflictCommandId: KeyCommandId;
      conflictLabel: string;
    };

export const KEYBIND_STORAGE_KEY = "wavefield:keybindings:v1";

export const RESERVED_KEY_COMMANDS = [
  {
    id: "ui.settings",
    label: "Settings",
    defaultKey: "Tab",
    locked: true,
  },
  {
    id: "ui.fullscreen",
    label: "Fullscreen",
    defaultKey: "KeyF",
    locked: true,
  },
  {
    id: "audio.playback",
    label: "Play / pause",
    defaultKey: "Space",
    locked: true,
  },
  {
    id: "boundary.freePlate",
    label: "Free Plate resonance",
    defaultKey: "Digit1",
    locked: true,
  },
  {
    id: "boundary.dirichlet",
    label: "Pinned resonance",
    defaultKey: "Digit2",
    locked: true,
  },
  {
    id: "boundary.neumann",
    label: "Open Edge resonance",
    defaultKey: "Digit3",
    locked: true,
  },
  {
    id: "boundary.clamped",
    label: "Clamped resonance",
    defaultKey: "Digit4",
    locked: true,
  },
  {
    id: "boundary.supported",
    label: "Supported resonance",
    defaultKey: "Digit5",
    locked: true,
  },
  {
    id: "template.previous",
    label: "Previous template",
    defaultKey: "ArrowLeft",
    locked: true,
  },
  {
    id: "template.next",
    label: "Next template",
    defaultKey: "ArrowRight",
    locked: true,
  },
] satisfies KeyCommand[];

export function createTemplateApplyCommandId(slug: string): KeyCommandId {
  return `template.apply.${slug}`;
}

export function buildKeyCommands(templates: WavefieldTemplate[]): KeyCommand[] {
  return [
    ...RESERVED_KEY_COMMANDS,
    ...templates.map((template) => ({
      id: createTemplateApplyCommandId(template.slug),
      label: `Apply ${template.name}`,
    })),
  ];
}

export function createDefaultKeyBindings(commands: KeyCommand[]): KeyBindingMap {
  return Object.fromEntries(
    commands
      .filter((command) => command.defaultKey)
      .map((command) => [command.id, command.defaultKey]),
  ) as KeyBindingMap;
}

export function coerceKeyBindings(
  input: unknown,
  commands: KeyCommand[],
): KeyBindingMap {
  const allowedCommandIds = new Set(commands.map((command) => command.id));
  const defaults = createDefaultKeyBindings(commands);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return defaults;
  }

  let bindings = { ...defaults };
  for (const [commandId, key] of Object.entries(input)) {
    if (
      !allowedCommandIds.has(commandId as KeyCommandId) ||
      typeof key !== "string" ||
      !key
    ) {
      continue;
    }

    const assignment = assignKeyBinding(
      commands,
      bindings,
      commandId as KeyCommandId,
      key,
    );
    if (assignment.ok) {
      bindings = assignment.bindings;
    }
  }

  return bindings;
}

export function assignKeyBinding(
  commands: KeyCommand[],
  bindings: KeyBindingMap,
  commandId: KeyCommandId,
  key: string,
): KeyBindAssignment {
  const command = commands.find((candidate) => candidate.id === commandId);
  if (!command || command.locked) {
    return {
      ok: false,
      conflictCommandId: commandId,
      conflictLabel: command?.label ?? commandId,
    };
  }

  const normalizedKey = normalizeKeyCode(key);
  const conflict = findKeyConflict(commands, bindings, commandId, normalizedKey);
  if (conflict) {
    return {
      ok: false,
      conflictCommandId: conflict.id,
      conflictLabel: conflict.label,
    };
  }

  return {
    ok: true,
    bindings: {
      ...bindings,
      [commandId]: normalizedKey,
    },
  };
}

export function clearKeyBinding(
  bindings: KeyBindingMap,
  commandId: KeyCommandId,
): KeyBindingMap {
  const nextBindings = { ...bindings };
  delete nextBindings[commandId];
  return nextBindings;
}

export function getCommandForKey(
  commands: KeyCommand[],
  bindings: KeyBindingMap,
  key: string,
): KeyCommand | null {
  const normalizedKey = normalizeKeyCode(key);
  const match = Object.entries(bindings).find(
    ([, boundKey]) => boundKey === normalizedKey,
  );
  if (!match) {
    return null;
  }

  return commands.find((command) => command.id === match[0]) ?? null;
}

export function formatKeyBinding(key: string | undefined) {
  if (!key) {
    return "Set";
  }

  if (key.startsWith("Key")) {
    return key.slice(3);
  }

  if (key.startsWith("Digit")) {
    return key.slice(5);
  }

  return key.replace(/^Arrow/, "");
}

export function normalizeKeyCode(key: string) {
  return key.trim();
}

export function getKeyboardEventCode(event: KeyboardEvent) {
  const code = normalizeKeyCode(event.code);
  if (code) {
    return code;
  }

  const key = normalizeKeyCode(event.key);
  if (!key) {
    return "";
  }
  if (key.length === 1) {
    const upperKey = key.toUpperCase();
    if (upperKey >= "A" && upperKey <= "Z") {
      return `Key${upperKey}`;
    }
    if (key >= "0" && key <= "9") {
      return `Digit${key}`;
    }
  }

  switch (key) {
    case " ":
    case "Spacebar":
      return "Space";
    case "Esc":
      return "Escape";
    case "Left":
      return "ArrowLeft";
    case "Right":
      return "ArrowRight";
    case "Up":
      return "ArrowUp";
    case "Down":
      return "ArrowDown";
    default:
      return key;
  }
}

function findKeyConflict(
  commands: KeyCommand[],
  bindings: KeyBindingMap,
  commandId: KeyCommandId,
  key: string,
) {
  return (
    commands.find((command) => {
      if (command.id === commandId) {
        return false;
      }

      return (bindings[command.id] ?? command.defaultKey) === key;
    }) ?? null
  );
}
