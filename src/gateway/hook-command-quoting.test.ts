import assert from "node:assert/strict";
import test from "node:test";

import {
  quoteHookCommandArgument,
  renderWindowsHookCommandPath,
  renderWindowsHookWrapper,
} from "../codex/runtime-config.js";

test("quotes managed Hook command arguments for Windows cmd.exe", () => {
  assert.equal(
    quoteHookCommandArgument("C:\\Program Files\\nodejs\\node.exe", "win32"),
    '"C:\\Program Files\\nodejs\\node.exe"',
  );
});

test("preserves POSIX single-quote escaping for managed Hook commands", () => {
  assert.equal(quoteHookCommandArgument("/opt/commerce pilot/node", "linux"), "'/opt/commerce pilot/node'");
  assert.equal(quoteHookCommandArgument("merchant's-agent", "linux"), `'merchant'"'"'s-agent'`);
});

test("renders a managed Windows Hook wrapper with only the required SystemRoot", () => {
  assert.equal(
    renderWindowsHookWrapper(
      ["C:\\Program Files\\nodejs\\node.exe", "D:\\Commerce Pilot\\hook.mjs"],
      "C:\\Windows",
    ),
    [
      "@echo off",
      'set "SystemRoot=C:\\Windows"',
      '"C:\\Program Files\\nodejs\\node.exe" "D:\\Commerce Pilot\\hook.mjs"',
      "exit /b %ERRORLEVEL%",
      "",
    ].join("\r\n"),
  );
  assert.throws(
    () => renderWindowsHookWrapper(["node.exe"], "C:\\Windows & whoami"),
    /safe absolute Windows path/,
  );
});

test("fails closed for Windows managed Hook paths that cmd.exe cannot safely invoke", () => {
  assert.equal(
    renderWindowsHookCommandPath("E:\\commerce-pilot\\managed-hooks\\commerce-runtime-hook.cmd"),
    "E:\\commerce-pilot\\managed-hooks\\commerce-runtime-hook.cmd",
  );
  assert.throws(
    () => renderWindowsHookCommandPath("E:\\Commerce Pilot\\managed-hooks\\commerce-runtime-hook.cmd"),
    /may not contain whitespace/,
  );
});
