# Visual regression gate

The Visual Regression workflow compares the English home page in Chromium on
Ubuntu 24.04 with a maximum differing-pixel ratio of 0.01. Missing baselines and
unexpected screenshot changes fail the job. Its visual-regression-report
artifact includes the HTML report, JSON results and expected/actual/diff images.
The separate metadata-only report workflow updates one PR comment for the
current head; it never executes PR code with a write token. It becomes active
once present on the default branch.

Storybook is also built. Chromatic publishes when the maintainer configures
CHROMATIC_PROJECT_TOKEN; forks do not receive that secret. The Playwright gate
runs independently. Chromatic changes are not silently accepted.

## Establish or intentionally update the baseline

Run Generate Visual Baseline on the exact reviewed source revision, or use
Ubuntu 24.04 with the lockfile-resolved Playwright Chromium:

```sh
npm ci
npx playwright install --with-deps chromium
CI=true NEXT_TELEMETRY_DISABLED=1 npx playwright test e2e/visual --project=chromium --update-snapshots
```

Review the generated home-page PNG before committing
`e2e/visual-baselines/visual/home.spec.ts-snapshots/home-chromium-linux.png`.
Re-run the normal comparison after any deliberate baseline change. Never
regenerate baselines during the blocking PR comparison. The generation workflow
uploads PNGs for review and never commits them or marks changes accepted.

The project still needs a real Linux baseline committed before this gate can
pass. No synthetic baseline is included. A branch-only generation trigger is
present for the initial source carrier and should be removed after its reviewed
baseline is committed.
