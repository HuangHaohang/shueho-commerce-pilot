# Hosted Harness model metadata

Source: OpenAI Codex `rust-v0.150.1`, commit `90854393966b21e9ebfd21b122334eb09a20c93d`, `codex-rs/models-manager/models.json`, distributed under the upstream Apache-2.0 license (see `vendor/codex/LICENSE.upstream`).

The sole metadata change is `tool_mode = direct` for every catalog entry. Commerce Pilot deliberately uses native direct Harness tools, not the optional standalone code-mode host. Model-specified `code_mode_only` otherwise overrides the feature toggle and attempts to spawn an unbundled executable. This metadata is loaded through the native `model_catalog_json` config; it does not implement tool dispatch or change the hosted allowlist, sandbox, provider identity, image Item lifecycle, or conversation history.

Gateway's live Provider catalog and server-owned selectors remain the authority for selectable/available models. This file describes native Harness behavior, not upstream availability. Refresh this snapshot from the same pinned Codex version whenever the application runtime is upgraded, preserving the direct tool-mode policy.
