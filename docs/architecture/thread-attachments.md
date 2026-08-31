# Thread Attachments

Commerce Pilot accepts tenant-owned photos and bounded document attachments without exposing the deployment host to browser users. Codex App Server remains the Turn owner.

## Supported Inputs

- Images: PNG, JPEG, and WebP. Gateway verifies the content signature and passes the tenant-scoped stored path to App Server as a native `localImage` Turn input.
- Documents: PDF, DOCX, XLSX, TXT, Markdown, CSV, JSON, XML, HTML, YAML, and log text. Gateway verifies the format and extracts bounded plain text before adding it as a separate attachment-context text input.
- One Turn may contain at most eight files and 5 MB total. The middleware reserves a small multipart-overhead allowance while the browser, BFF, and Gateway all enforce the same 5 MB content limit.

## Ownership Flow

1. The composer keeps selected browser `File` objects locally and renders image previews or document labels.
2. On send, the files leave the composer immediately and appear in the optimistic user message.
3. After the BFF creates or verifies the thread, it uploads files to Gateway with the same `clientRequestId` used for `turn/start`.
4. Gateway binds every artifact to tenant, workspace, user, root thread, and client request. Browser-supplied paths and MIME declarations are never authoritative.
5. `turn/start` accepts only artifact ids. Gateway reloads metadata, rechecks ownership and request binding, and builds native `localImage` or bounded document-context inputs.
6. Once App Server returns a Turn id, Gateway binds the artifacts to that Turn. History restoration returns only sanitized metadata and ownership-checked BFF URLs.

Native reply retry does not download an attachment through the browser and upload it under browser-reconstructed history. Gateway first verifies the selected assistant Item and source Turn through App Server, then reloads only artifacts already bound to that owned Turn, rebuilds their native `localImage` or bounded document inputs, performs the history-mode-compatible native `thread/revert` or `thread/rollback`, and rebinds the same application artifacts to the replacement `turn/start` result. Browser-supplied artifact ids and host paths are not accepted by the retry endpoint.

Upload failure removes any artifacts already written for that unbound request. Turn failure removes the optimistic user message and restores the original composer files. Successful submission revokes local preview URLs and leaves attachments only in the user message.

## Storage And Deletion

Artifacts live under:

```text
$CODEX_HOME/thread_artifacts/<threadId>/<artifactId>/
```

Each directory contains owner-only metadata, the original binary under an application-generated filename, and optional extracted text. Production App Server and Gateway must share only the dedicated tenant runtime/artifact volume. The browser cannot request a host path.

Permanent `thread/delete` removes the complete thread artifact directory after App Server confirms thread-tree deletion. This includes uploaded photos, uploaded documents, extracted text, and future thread-scoped media.

## Browser Event Boundary

App Server `userMessage` events can contain `localImage.path` and extracted document input. Gateway sanitizes browser SSE events before fan-out:

- `localImage` remains as a type marker but its path is removed;
- extracted `<commerce_attachment_context>` text is removed;
- the user-authored message and safe attachment manifest remain available for reconciliation.

The authenticated history endpoint reconstructs attachment previews from artifact metadata rather than native paths.
