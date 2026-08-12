import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const consoleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const routesRoot = path.join(consoleRoot, "src", "app", "api", "aione");
const bundledSpecPath = path.join(
  consoleRoot,
  "public",
  "openapi",
  "aione.yaml",
);
const httpMethods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);
const supportedMethods =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const compatibilityRouteMethods = new Map([
  // Next.js resolves /model/run through the sibling [id] route before the
  // generic /[type]/run route. The handler delegates only the reserved
  // "run" id to that documented endpoint and rejects every other POST id.
  ["/api/aione/model/{id}", new Set(["post"])],
]);

async function listRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listRouteFiles(entryPath);
      return entry.isFile() && entry.name === "route.ts" ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

function routePath(routeFile) {
  const segments = path
    .relative(routesRoot, path.dirname(routeFile))
    .split(path.sep);
  return `/api/aione/${segments
    .map((segment) =>
      segment.replace(/^\[\.\.\.(.+)]$/, "{$1}").replace(/^\[(.+)]$/, "{$1}"),
    )
    .join("/")}`;
}

function methodsFromSource(source) {
  return [...source.matchAll(supportedMethods)]
    .map((match) => match[1].toLowerCase())
    .sort();
}

const spec = parse(await readFile(bundledSpecPath, "utf8"));
const routeFiles = await listRouteFiles(routesRoot);
const documented = new Map(
  Object.entries(spec.paths ?? {}).map(([apiPath, item]) => [
    apiPath,
    Object.keys(item)
      .filter((key) => httpMethods.has(key))
      .sort(),
  ]),
);
const implemented = new Map(
  await Promise.all(
    routeFiles.map(async (routeFile) => {
      const apiPath = routePath(routeFile);
      const compatibilityMethods =
        compatibilityRouteMethods.get(apiPath) ?? new Set();
      return [
        apiPath,
        methodsFromSource(await readFile(routeFile, "utf8")).filter(
          (method) => !compatibilityMethods.has(method),
        ),
      ];
    }),
  ),
);

const errors = [];
for (const [apiPath, methods] of implemented) {
  const documentedMethods = documented.get(apiPath);
  if (!documentedMethods)
    errors.push(`Missing OpenAPI path for route: ${apiPath}`);
  else if (methods.join(",") !== documentedMethods.join(",")) {
    errors.push(
      `Method mismatch for ${apiPath}: implemented [${methods}] documented [${documentedMethods}]`,
    );
  }
}
for (const apiPath of documented.keys()) {
  if (!implemented.has(apiPath))
    errors.push(`OpenAPI path has no AIONE route: ${apiPath}`);
}
if (errors.length > 0)
  throw new Error(
    `OpenAPI contract verification failed:\n${errors.join("\n")}`,
  );

console.log(
  `Verified ${implemented.size} AIONE route paths against the bundled OpenAPI contract.`,
);
