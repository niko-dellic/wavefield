export type ShellElements = {
  canvas: HTMLCanvasElement;
  playButton: HTMLButtonElement;
  volumeButton: HTMLButtonElement;
  volumeSlider: HTMLInputElement;
  sourceTrigger: HTMLButtonElement;
  sourceMenu: HTMLElement;
  sourcePicker: HTMLElement;
  selectedSource: HTMLElement;
  fullscreenButton: HTMLButtonElement;
  aboutButton: HTMLButtonElement;
  aboutModal: HTMLElement;
  aboutPanel: HTMLElement;
  aboutCloseButton: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
  boundaryInputs: HTMLInputElement[];
  settingsModal: HTMLElement;
  settingsPanel: HTMLElement;
  settingsCloseButton: HTMLButtonElement;
  desktopDriveHost: HTMLElement;
  mobileDriveHost: HTMLElement;
  drivePane: HTMLDetailsElement;
  driveSummaryValue: HTMLElement;
  driveModeSelect: HTMLSelectElement;
  modeSettingsHost: HTMLElement;
  transport: HTMLElement;
  guiHost: HTMLElement;
  waveform: HTMLElement;
  uploadButton: HTMLButtonElement;
  audioFileInput: HTMLInputElement;
  fixtureButtons: HTMLButtonElement[];
};

export function queryShellElements(root: HTMLElement): ShellElements {
  return {
    canvas: query(root, ".wavefield-canvas"),
    playButton: query(root, ".play-toggle"),
    volumeButton: query(root, ".volume-toggle"),
    volumeSlider: query(root, ".volume-slider"),
    sourceTrigger: query(root, ".source-trigger"),
    sourceMenu: query(root, ".source-menu"),
    sourcePicker: query(root, ".source-picker"),
    selectedSource: query(root, ".selected-source"),
    fullscreenButton: query(root, ".fullscreen-toggle"),
    aboutButton: query(root, ".about-toggle"),
    aboutModal: query(root, ".about-modal"),
    aboutPanel: query(root, ".about-panel"),
    aboutCloseButton: query(root, ".about-close"),
    settingsButton: query(root, ".settings-toggle"),
    boundaryInputs: Array.from(
      root.querySelectorAll<HTMLInputElement>(".boundary-radio-input"),
    ),
    settingsModal: query(root, ".settings-modal"),
    settingsPanel: query(root, ".settings-panel"),
    settingsCloseButton: query(root, ".settings-close"),
    desktopDriveHost: query(root, ".desktop-drive-host"),
    mobileDriveHost: query(root, ".mobile-drive-host"),
    drivePane: query(root, ".drive-pane"),
    driveSummaryValue: query(root, ".drive-summary-value"),
    driveModeSelect: query(root, ".drive-mode-select"),
    modeSettingsHost: query(root, ".mode-settings-host"),
    transport: query(root, ".transport"),
    guiHost: query(root, ".pane-host"),
    waveform: query(root, ".waveform"),
    uploadButton: query(root, ".upload-option"),
    audioFileInput: query(root, ".audio-file"),
    fixtureButtons: Array.from(
      root.querySelectorAll<HTMLButtonElement>("[data-fixture-url]"),
    ),
  };
}

function query<T extends Element>(root: HTMLElement, selector: string) {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}
