import { mkdir, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sep } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const TEMPLATE_DIR = resolve(ROOT_DIR, "src/templates");
const MAX_TEMPLATE_BODY_BYTES = 1_000_000;

export default defineConfig({
  plugins: [wavefieldTemplateMiddleware()],
});

function wavefieldTemplateMiddleware(): Plugin {
  return {
    name: "wavefield-template-middleware",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://wavefield.local");
        if (!url.pathname.startsWith("/api/templates")) {
          next();
          return;
        }

        try {
          if (request.method === "POST" && url.pathname === "/api/templates") {
            await handleSaveTemplate(request, response);
            return;
          }

          const deleteMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
          if (request.method === "DELETE" && deleteMatch) {
            await handleDeleteTemplate(deleteMatch[1], response);
            return;
          }

          sendJson(response, 405, { error: "Unsupported template request" });
        } catch (error) {
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : "Template request failed",
          });
        }
      });
    },
  };
}

async function handleSaveTemplate(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const payload = await readJsonBody(request);
  if (!isRecord(payload)) {
    sendJson(response, 400, { error: "Template payload must be an object" });
    return;
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    sendJson(response, 400, { error: "Template name is required" });
    return;
  }

  if (!isRecord(payload.settings)) {
    sendJson(response, 400, { error: "Template settings must be an object" });
    return;
  }

  const slug = slugifyTemplateName(name);
  const template = {
    name,
    createdAt: new Date().toISOString(),
    settings: payload.settings,
  };
  await mkdir(TEMPLATE_DIR, { recursive: true });
  await writeFile(
    getTemplateFilePath(slug),
    `${JSON.stringify(template, null, 2)}\n`,
    "utf8",
  );
  sendJson(response, 200, {
    template: {
      slug,
      ...template,
    },
  });
}

async function handleDeleteTemplate(
  encodedSlug: string,
  response: ServerResponse,
) {
  const slug = normalizeTemplateSlug(decodeURIComponent(encodedSlug));
  if (!slug) {
    sendJson(response, 400, { error: "Invalid template slug" });
    return;
  }

  try {
    await unlink(getTemplateFilePath(slug));
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  sendJson(response, 200, { ok: true });
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_TEMPLATE_BODY_BYTES) {
        reject(new Error("Template payload is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(body));
      } catch {
        reject(new Error("Template payload must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function slugifyTemplateName(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "template"
  );
}

function normalizeTemplateSlug(slug: string) {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) ? slug : null;
}

function getTemplateFilePath(slug: string) {
  const filePath = resolve(TEMPLATE_DIR, `${slug}.json`);
  if (!filePath.startsWith(`${TEMPLATE_DIR}${sep}`)) {
    throw new Error("Invalid template path");
  }
  return filePath;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
