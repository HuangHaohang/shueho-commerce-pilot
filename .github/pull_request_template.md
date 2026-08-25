## Outcome

<!-- What business/user outcome does this PR deliver? -->

## Harness And Architecture

- App Server API / Skill / Tool / MCP used:
- Responsibilities that remain owned by Codex Harness:
- Browser -> BFF -> Gateway boundary preserved: yes / no

## Security And Data

- Tenant/RBAC/RLS impact:
- External write, approval, idempotency, and readback impact:
- Secrets, PII, attachments, or artifact lifecycle impact:

## Database And Operations

- Migration added: none / path
- Worker, volume, environment, or deployment changes:
- Backfill or operator command required:

## Verification

- [ ] `npm run check`
- [ ] `npm run web:check`
- [ ] `npm run test:gateway`
- [ ] `npm run web:test`
- [ ] `npm run security:runtime`
- [ ] `npm run web:build`
- [ ] `git diff --check`
- [ ] Database isolation checks, when applicable
- [ ] Desktop/mobile visual verification, when applicable
- [ ] Real external-system readback, when applicable

## Delivery State

- [ ] Implemented locally
- [ ] Committed
- [ ] Pushed
- [ ] Deployed, if requested
- [ ] Verified in target environment, if requested

## Known Limitations

<!-- State remaining risk or follow-up work explicitly. -->
