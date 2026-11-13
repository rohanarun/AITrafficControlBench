# Contributing

The easiest contribution is a controller that improves safe landings on the hosted arena. Share its source and a link to its server-executed result in an issue or PR. The hosted service accepts actions only, never your executable code.

For repository changes:

1. Fork and create a branch.
2. Keep controller policy in prompts or your agent implementation. For a model controller failure, include the failing trace, describe what went wrong, and update its system prompt with general expected behavior. Do not add seed-specific response patches.
3. Add meaningful tests for simulator correctness, scoring, or protocol changes. Run `npm ci`, `npm test`, and `npm run build`.
4. Open a PR with the problem, resulting behavior, validation, and limits. Changes to benchmark rules require a new version; do not silently move existing scores onto changed rules.

Useful contributions include new agent adapters, trajectory planning approaches, adversarial safety fixtures, accessible visualizations, cost/latency reporting, richer aircraft models, authenticated teams, and hidden-seed tournaments.

For local full-suite submissions, run `npm run verify -- --file .local/run.json --official`, then place the JSON in `submissions/your-controller.json`. CI replays it. Maintainers must inspect source/provenance and use trusted baseline simulator code when evaluating changes to scoring. Local replay verification does not attest agent identity. Never combine a simulator rule change and a claimed leaderboard improvement without changing the benchmark version.

Do not commit API keys, session tokens, personal data, model-provider logs containing secrets, or `.local/`. CI must not execute contributor agents with repository secrets or publish credentials. It runs tests/builds in an unprivileged PR job. A maintainer deployment remains a separate operation.
