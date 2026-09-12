import assert from "node:assert/strict";
import test from "node:test";
import { assertManagedWindowsHook } from "../../scripts/runtime-security/managed-windows-hook.js";

const commandPath = "E:\\commerce\\codex\\managed-hooks\\commerce-runtime-hook.PreToolUse.cmd";
const wrapperSource = [
  "@echo off",
  'set "SystemRoot=C:\\Windows"',
  '"C:\\node\\node.exe" "E:\\commerce\\codex\\managed-hooks\\commerce-runtime-hook.mjs" "E:\\commerce\\codex\\hook-audit\\events.jsonl" "PreToolUse"',
  "exit /b %ERRORLEVEL%", "",
].join("\r\n");
const section = (path: string) => `[[hooks.PreToolUse]]\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommandWindows = ${JSON.stringify(path)}\ntimeout = 5\n`;
const fixture = { generatedConfig: section(commandPath), eventName: "PreToolUse", commandPath, wrapperSource, expectedWrapperSource: wrapperSource };

test("accepts event-specific managed Windows wrappers with LF or CRLF config", () => {
  assertManagedWindowsHook(fixture);
  assertManagedWindowsHook({ ...fixture, generatedConfig: fixture.generatedConfig.replace(/\n/g, "\r\n") });
  assertManagedWindowsHook({ ...fixture, generatedConfig: `${fixture.generatedConfig}\n[model_providers.fixture]\nwire_api = "responses"\n` });
});

test("rejects missing or duplicate event bindings instead of searching a global filename substring", () => {
  assert.throws(() => assertManagedWindowsHook({ ...fixture, generatedConfig: '# commerce-runtime-hook.cmd\n' }), /exactly one managed/);
  assert.throws(() => assertManagedWindowsHook({ ...fixture, generatedConfig: fixture.generatedConfig.repeat(2) }), /exactly one managed/);
  assert.throws(() => assertManagedWindowsHook({ ...fixture, generatedConfig: fixture.generatedConfig.replace("commandWindows =", "unused =") }), /owned PreToolUse/);
});

test("rejects browser paths, legacy shared wrappers, and binding the wrong policy event", () => {
  for (const path of ["E:\\tenant\\unmanaged.cmd", commandPath.replace(".PreToolUse.cmd", ".cmd"), commandPath.replace("PreToolUse", "PostToolUse")]) {
    assert.throws(() => assertManagedWindowsHook({ ...fixture, generatedConfig: section(path) }), /owned PreToolUse/);
  }
});

test("rejects wrapper tampering including removed SystemRoot, success-exit override and extra commands", () => {
  for (const changed of [wrapperSource.replace('set "SystemRoot=C:\\Windows"\r\n', ""), wrapperSource.replace("%ERRORLEVEL%", "0"), `${wrapperSource}echo injected\r\n`, wrapperSource.replace('"PreToolUse"', '"PostToolUse"')]) {
    assert.throws(() => assertManagedWindowsHook({ ...fixture, wrapperSource: changed }), /differs from its application-owned command/);
  }
});
