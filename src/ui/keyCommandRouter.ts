import type { AudioController } from "../audio/audioController";
import type { KeyCommandId } from "../keybindings";
import type { TemplateController } from "../templates/templateController";
import type { BoundaryMode, CymaticSettings } from "../types";
import { OverlayController } from "./overlayController";
import type { ShellElements } from "./shellElements";

type BoundaryCommandId = Extract<KeyCommandId, `boundary.${string}`>;

const BOUNDARY_COMMANDS = {
  "boundary.freePlate": "freePlate",
  "boundary.dirichlet": "dirichlet",
  "boundary.neumann": "neumann",
  "boundary.clamped": "clamped",
  "boundary.supported": "supported",
} satisfies Record<BoundaryCommandId, BoundaryMode>;

export type KeyCommandRouterOptions = {
  root: HTMLElement;
  settings: CymaticSettings;
  ui: Pick<ShellElements, "settingsButton">;
  audio: AudioController;
  overlayController: OverlayController;
  templates: TemplateController;
  onBoundaryMode: (boundaryMode: BoundaryMode) => void;
};

export class KeyCommandRouter {
  constructor(private readonly options: KeyCommandRouterOptions) {}

  run(commandId: KeyCommandId) {
    if (isBoundaryCommand(commandId)) {
      this.options.onBoundaryMode(BOUNDARY_COMMANDS[commandId]);
      return;
    }

    switch (commandId) {
      case "ui.settings":
        this.toggleSettings();
        return;
      case "ui.fullscreen":
        void this.options.overlayController.toggleFullscreen();
        return;
      case "audio.playback":
        if (
          this.options.settings.driveMode === "audio" ||
          this.options.settings.driveMode === "manual"
        ) {
          void this.options.audio.togglePlayback();
        }
        return;
      case "template.previous":
        this.options.templates.cycleTemplate(-1);
        return;
      case "template.next":
        this.options.templates.cycleTemplate(1);
        return;
      default:
        this.options.templates.runApplyCommand(commandId);
    }
  }

  private toggleSettings() {
    const { root, ui, overlayController } = this.options;
    if (document.fullscreenElement === root) {
      overlayController.setFullscreenUiVisible(
        !overlayController.isFullscreenUiVisible,
      );
      return;
    }

    overlayController.setSettingsOpen(
      !overlayController.isSettingsOpen,
      ui.settingsButton,
    );
  }
}

function isBoundaryCommand(commandId: KeyCommandId): commandId is BoundaryCommandId {
  return commandId.startsWith("boundary.");
}
