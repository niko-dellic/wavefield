import type { BoundaryMode } from "../types";
import shellHtml from "./shell.html?raw";
import { BOUNDARY_OPTIONS } from "./format";

export type ShellFixture = {
  label: string;
  url: string;
};

export function renderWavefieldShell(
  fixtures: ShellFixture[],
  boundaryMode: BoundaryMode,
) {
  return shellHtml
    .replace("{{FIXTURE_OPTIONS}}", renderFixtureOptions(fixtures))
    .replace("{{BOUNDARY_OPTIONS}}", renderBoundaryOptions(boundaryMode));
}

function renderFixtureOptions(fixtures: ShellFixture[]) {
  return fixtures
    .map(
      (fixture) =>
        `<button class="source-option" type="button" role="option" data-fixture-url="${escapeAttribute(fixture.url)}">
          <i class="ph ph-music-note-simple" aria-hidden="true"></i>
          <span>${escapeHtml(fixture.label)}</span>
        </button>`,
    )
    .join("");
}

function renderBoundaryOptions(boundaryMode: BoundaryMode) {
  return BOUNDARY_OPTIONS.map(
    (option) => `
      <label class="boundary-radio-option" title="${escapeAttribute(`${option.title} (${option.shortcut})`)}">
        <input
          class="boundary-radio-input"
          type="radio"
          name="boundary-mode"
          value="${option.value}"
          ${option.value === boundaryMode ? "checked" : ""}
        />
        <span class="boundary-radio-shortcut">${option.shortcut}</span>
        <span class="boundary-radio-title">${option.label}</span>
      </label>
    `,
  ).join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}
