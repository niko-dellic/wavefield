import type { ControlsManager } from "./controls";
import type { ShellElements } from "./shellElements";

const MOBILE_SETTINGS_MEDIA = "(max-width: 560px)";

export type OverlayControllerOptions = {
  root: HTMLElement;
  ui: Pick<
    ShellElements,
    | "aboutButton"
    | "aboutCloseButton"
    | "aboutModal"
    | "aboutPanel"
    | "desktopDriveHost"
    | "drivePane"
    | "fullscreenButton"
    | "mobileDriveHost"
    | "settingsButton"
    | "settingsCloseButton"
    | "settingsModal"
    | "settingsPanel"
  >;
  controls: ControlsManager;
  onStatus: (message: string) => void;
};

export class OverlayController {
  isAboutOpen = false;
  isSettingsOpen = false;
  isMobileSettings = false;
  isFullscreenUiVisible = false;

  private readonly mobileSettingsMedia = window.matchMedia(
    MOBILE_SETTINGS_MEDIA,
  );
  private readonly disposers: Array<() => void> = [];
  private lastAboutTrigger: HTMLElement | null = null;
  private lastSettingsTrigger: HTMLElement | null = null;

  constructor(private readonly options: OverlayControllerOptions) {}

  bind() {
    const { ui } = this.options;

    this.addEventListener(ui.fullscreenButton, "click", () => {
      void this.toggleFullscreen();
    });
    this.addEventListener(ui.aboutButton, "click", () => {
      this.setAboutOpen(true, ui.aboutButton);
    });
    this.addEventListener(ui.aboutCloseButton, "click", () => {
      this.setAboutOpen(false);
    });
    this.addEventListener(ui.aboutModal, "click", (event) => {
      if (!ui.aboutPanel.contains(event.target as Node)) {
        this.setAboutOpen(false);
      }
    });
    this.addEventListener(ui.settingsButton, "click", () => {
      this.setSettingsOpen(!this.isSettingsOpen, ui.settingsButton);
    });
    this.addEventListener(ui.settingsCloseButton, "click", () => {
      this.setSettingsOpen(false);
    });
    this.addDocumentListener("fullscreenchange", this.handleFullscreenChange);

    this.syncSettingsMode();
    this.syncSettingsModal();
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }

  syncSettingsMode() {
    const isMobileSettings = this.mobileSettingsMedia.matches;
    if (this.isMobileSettings === isMobileSettings) {
      return;
    }

    this.isMobileSettings = isMobileSettings;
    this.syncDriveSettingsLocation();
    this.syncSettingsModal();
  }

  setAboutOpen(isOpen: boolean, trigger: HTMLElement | null = null) {
    if (this.isAboutOpen === isOpen) {
      return;
    }

    this.isAboutOpen = isOpen;
    this.lastAboutTrigger = isOpen ? trigger : this.lastAboutTrigger;
    this.syncAboutModal();
  }

  setSettingsOpen(isOpen: boolean, trigger: HTMLElement | null = null) {
    if (this.isSettingsOpen === isOpen) {
      return;
    }

    this.isSettingsOpen = isOpen;
    this.lastSettingsTrigger = isOpen ? trigger : this.lastSettingsTrigger;
    this.syncSettingsModal();
  }

  setFullscreenUiVisible(isVisible: boolean) {
    if (
      this.isFullscreenUiVisible === isVisible &&
      this.isSettingsOpen === isVisible
    ) {
      return;
    }

    this.isFullscreenUiVisible = isVisible;
    this.setSettingsOpen(isVisible, this.options.ui.settingsButton);
    this.options.root.classList.toggle("is-fullscreen-ui-visible", isVisible);
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await this.options.root.requestFullscreen();
    } catch (error) {
      this.options.onStatus(
        error instanceof Error ? error.message : "Fullscreen is unavailable",
      );
    }
  }

  private syncAboutModal() {
    const { root, ui } = this.options;
    ui.aboutModal.hidden = !this.isAboutOpen;
    ui.aboutModal.setAttribute("aria-hidden", String(!this.isAboutOpen));
    ui.aboutButton.setAttribute("aria-expanded", String(this.isAboutOpen));
    root.classList.toggle("is-about-open", this.isAboutOpen);

    if (this.isAboutOpen) {
      requestAnimationFrame(() => {
        this.getAboutFocusableElements()[0]?.focus();
      });
      return;
    }

    this.lastAboutTrigger?.focus();
  }

  private syncSettingsModal() {
    const { root, ui, controls } = this.options;
    const shouldShowSettings = this.isSettingsOpen;
    ui.settingsModal.hidden = !this.isSettingsOpen;
    ui.settingsModal.setAttribute(
      "aria-hidden",
      String(!this.isSettingsOpen),
    );
    ui.settingsPanel.setAttribute(
      "role",
      this.isMobileSettings ? "dialog" : "complementary",
    );
    if (this.isMobileSettings) {
      ui.settingsPanel.setAttribute("aria-modal", "true");
    } else {
      ui.settingsPanel.removeAttribute("aria-modal");
    }
    ui.settingsButton.setAttribute(
      "aria-expanded",
      String(shouldShowSettings),
    );
    ui.settingsButton.setAttribute(
      "aria-label",
      shouldShowSettings ? "Close settings" : "Open settings",
    );
    root.classList.toggle("is-settings-open", this.isSettingsOpen);
    root.classList.toggle("is-mobile-settings", this.isMobileSettings);
    root.classList.toggle(
      "is-fullscreen-ui-visible",
      this.isFullscreenUiVisible,
    );

    if (this.isSettingsOpen) {
      controls.refresh();
      if (this.isMobileSettings) {
        requestAnimationFrame(() => {
          this.getSettingsFocusableElements()[0]?.focus();
        });
      }
      return;
    }

    if (this.isMobileSettings) {
      this.lastSettingsTrigger?.focus();
    }
  }

  private syncDriveSettingsLocation() {
    const { ui } = this.options;
    const targetHost = this.isMobileSettings
      ? ui.mobileDriveHost
      : ui.desktopDriveHost;
    if (ui.drivePane.parentElement !== targetHost) {
      targetHost.append(ui.drivePane);
    }
  }

  private readonly handleFullscreenChange = () => {
    const isFullscreen = document.fullscreenElement === this.options.root;
    if (isFullscreen) {
      this.setFullscreenUiVisible(false);
    } else {
      this.isFullscreenUiVisible = false;
      this.options.root.classList.remove("is-fullscreen-ui-visible");
    }
    this.options.root.classList.toggle("is-fullscreen", isFullscreen);
  };

  private getAboutFocusableElements() {
    return getFocusableElements(this.options.ui.aboutPanel);
  }

  private getSettingsFocusableElements() {
    return getFocusableElements(this.options.ui.settingsPanel);
  }

  private addEventListener<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) {
    target.addEventListener(type, listener);
    this.disposers.push(() => {
      target.removeEventListener(type, listener);
    });
  }

  private addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
  ) {
    document.addEventListener(type, listener);
    this.disposers.push(() => {
      document.removeEventListener(type, listener);
    });
  }
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.offsetParent !== null,
  );
}
