/**
 * FM3 gate (P14 — no PII/token leakage surface, no third-party telemetry):
 * a grep-gate over every web source file. It fails when someone introduces
 * console logging (PII/token leak channel), long-lived localStorage token
 * persistence (XSS blast-radius — tokens live in memory / per-tab only),
 * cookie fiddling outside the auth design, or any third-party
 * analytics/telemetry/CDN reference (gate 1.6: no PII in analytics; no
 * scripts pulled from CDNs).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const WEB_ROOT = join(__dirname, "..", "..");
const SCAN_ROOTS = [join(WEB_ROOT, "src"), join(WEB_ROOT, "packages")];
const EXTENSIONS = [".ts", ".tsx", ".css", ".mjs"];
const SELF = join("src", "__tests__", "client-hygiene.test.ts");

// Built by concatenation so this file never matches itself elsewhere.
const FORBIDDEN: readonly { pattern: string; reason: string }[] = [
  { pattern: "console" + ".", reason: "console logging can leak PII/token material" },
  { pattern: "local" + "Storage", reason: "tokens/state must not persist beyond the tab" },
  { pattern: "document" + ".cookie", reason: "no cookie-based token handling" },
  { pattern: "gtag", reason: "third-party analytics forbidden" },
  { pattern: "googletagmanager", reason: "third-party analytics forbidden" },
  { pattern: "google-analytics", reason: "third-party analytics forbidden" },
  { pattern: "mixpanel", reason: "third-party analytics forbidden" },
  { pattern: "posthog", reason: "third-party analytics forbidden" },
  { pattern: "hotjar", reason: "third-party analytics forbidden" },
  { pattern: "amplitude", reason: "third-party analytics forbidden" },
  { pattern: "segment" + ".com", reason: "third-party analytics forbidden" },
  { pattern: "datadoghq", reason: "third-party telemetry forbidden" },
  { pattern: "sentry" + ".io", reason: "third-party error reporting forbidden" },
  { pattern: "cdn" + ".jsdelivr", reason: "no scripts pulled from CDNs" },
  { pattern: "unpkg" + ".com", reason: "no scripts pulled from CDNs" },
  { pattern: "cdnjs" + ".cloudflare", reason: "no scripts pulled from CDNs" },
];

function collectFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      files.push(...collectFiles(path));
    } else if (EXTENSIONS.some((ext) => path.endsWith(ext))) {
      files.push(path);
    }
  }
  return files;
}

describe("client hygiene (FM3)", () => {
  const files = SCAN_ROOTS.flatMap((root) => collectFiles(root)).filter(
    (path) => relative(WEB_ROOT, path).split(sep).join("/") !== SELF.split(sep).join("/"),
  );

  it("scans a non-trivial source tree (sanity: the gate cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(FORBIDDEN)("no source file contains '$pattern' ($reason)", ({ pattern }) => {
    const offenders = files.filter((path) =>
      readFileSync(path, "utf8").includes(pattern),
    );
    expect(offenders.map((path) => relative(WEB_ROOT, path))).toEqual([]);
  });

  it("package.json pulls no analytics/telemetry dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(join(WEB_ROOT, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    const denied = ["analytics", "sentry", "posthog", "mixpanel", "amplitude", "datadog", "segment", "hotjar", "gtag"];
    expect(names.filter((name) => denied.some((bad) => name.includes(bad)))).toEqual([]);
  });
});
