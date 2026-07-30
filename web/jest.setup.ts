import "@testing-library/jest-dom";

// JSDOM doesn't expose crypto.randomUUID — polyfill it from Node's built-in
// crypto module so any code that calls it (idempotencyKeyFor, etc.) works in tests.
if (typeof (globalThis.crypto as Partial<Crypto>).randomUUID !== "function") {
  const { randomUUID } = require("node:crypto") as { randomUUID: () => `${string}-${string}-${string}-${string}-${string}` };
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: randomUUID,
    writable: false,
    configurable: true,
  });
}
