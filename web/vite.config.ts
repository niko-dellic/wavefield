import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { defineConfig, type Connect, type Plugin } from "vite";

const fixtureRoot = path.resolve(__dirname, "../fixtures/audio");
const fixturePrefix = "/fixtures/audio/";

function contentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".mp3") {
    return "audio/mpeg";
  }

  if (extension === ".wav") {
    return "audio/wav";
  }

  return "application/octet-stream";
}

function createFixtureAudioHandler(): Connect.NextHandleFunction {
  return (request, response, next) => {
    const requestUrl = new URL(request.url ?? "/", "http://wavefield.local");

    if (!requestUrl.pathname.startsWith(fixturePrefix)) {
      next();
      return;
    }

    void (async () => {
      const relativePath = decodeURIComponent(
        requestUrl.pathname.slice(fixturePrefix.length),
      );

      if (
        relativePath.length === 0 ||
        relativePath.includes("..") ||
        path.isAbsolute(relativePath)
      ) {
        response.statusCode = 400;
        response.end("Invalid fixture path");
        return;
      }

      const filePath = path.resolve(fixtureRoot, relativePath);
      if (!filePath.startsWith(fixtureRoot + path.sep)) {
        response.statusCode = 403;
        response.end("Fixture path rejected");
        return;
      }

      const fileInfo = await stat(filePath).catch(() => null);
      if (!fileInfo?.isFile()) {
        response.statusCode = 404;
        response.end("Fixture not found");
        return;
      }

      const rangeHeader = request.headers.range;
      response.setHeader("Content-Type", contentType(filePath));
      response.setHeader("Accept-Ranges", "bytes");

      if (rangeHeader) {
        const range = parseRange(rangeHeader, fileInfo.size);
        if (!range) {
          response.statusCode = 416;
          response.setHeader("Content-Range", `bytes */${fileInfo.size}`);
          response.end();
          return;
        }

        response.statusCode = 206;
        response.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${fileInfo.size}`,
        );
        response.setHeader("Content-Length", range.end - range.start + 1);
        createReadStream(filePath, range).pipe(response);
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Length", fileInfo.size);
      createReadStream(filePath).pipe(response);
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "Fixture error");
    });
  };
}

function parseRange(rangeHeader: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }

  const [, startText, endText] = match;
  let start = startText ? Number.parseInt(startText, 10) : 0;
  let end = endText ? Number.parseInt(endText, 10) : size - 1;

  if (!startText && endText) {
    const suffixLength = Number.parseInt(endText, 10);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function fixtureAudioPlugin(): Plugin {
  return {
    name: "wavefield-fixture-audio",
    configureServer(server) {
      server.middlewares.use(createFixtureAudioHandler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createFixtureAudioHandler());
    },
  };
}

export default defineConfig({
  plugins: [fixtureAudioPlugin()],
});
