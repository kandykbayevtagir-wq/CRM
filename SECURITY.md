# Security policy

This is proprietary software. Security reporting does not grant a license to use or redistribute it.

Only the latest reviewed production release is maintained. Reliability patches are prepared in pull requests and require quality checks and a separate reviewer before publication.

## Reporting

Use the repository's private vulnerability reporting facility if enabled, or contact the repository owner privately. Do not open a public issue containing exploit instructions, customer data, credentials or production dumps. Include the affected commit, reproduction in an isolated environment and expected impact.

Do not test against production without the owner's explicit authorization.

## Automated checks

CI performs production and development dependency audits, dependency review, CodeQL, TypeScript, lint, unit/integration, real local Pages/D1 and browser checks. GitHub secret scanning and push protection are repository settings, not guarantees that no secret has ever been exposed.

A discovered credential must be revoked and rotated in the owning service. Removing it from a new commit does not invalidate copies or published history. Never rewrite published tags to disguise an incident.
