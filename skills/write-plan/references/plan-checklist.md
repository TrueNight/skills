# ExecPlan Checklist

Use this after drafting and after each major revision.

## Self-Containment

- The plan explains the user-visible outcome in plain language.
- The plan names repository-relative paths, commands, tests, and important modules precisely.
- The plan defines non-obvious terms when they first appear.
- The plan does not rely on "see prior doc" or unstated context.
- The active plan file lives in `docs/exec_plans/active/` relative to the git repository root, or the project root as fallback.
- The filename uses `YYYY-MM-DD-short-plan-name.md`.
- Helper files from this skill are resolved from `write-plan/`, not from the repository root.

## Living Document Quality

- `Progress` exists and reflects the actual current state.
- `Progress` uses checkbox items, with a timestamp on every ticked item.
- `Surprises & Discoveries` captures unexpected findings with evidence.
- `Decision Log` records the important choices and why they were made.
- `Outcomes & Retrospective` is updated at milestone boundaries or completion.
- Completed plans explicitly record that they are ready to move, or have moved, to `docs/exec_plans/archive/`.
- If unresolved questions or blockers exist, an `Open Questions` section is present with stable `OQ-###` identifiers plus `Question / Context / Blocking` entries, and resolved questions have been moved into `Decision Log` with their identifiers preserved.

## Execution Readiness

- `Plan of Work` explains what to edit and why.
- `Concrete Steps` gives exact commands and working directories.
- `Validation and Acceptance` describes observable success, not only internal code changes.
- `Idempotence and Recovery` explains safe retries, rollback, or continuation paths.

## Milestones

- Milestones are narrative, not just headings with checkboxes.
- Each milestone can be validated independently.
- Each milestone advances the final user-visible outcome.
- Every milestone changes something or verifies what an earlier milestone built; no-code checks ran during planning and are logged in `Artifacts and Notes` with their result and commit SHA.

## Failure Modes To Catch

- The plan was written without a grill, and the user did not explicitly decline one.
- The plan is only a summary or brainstorm.
- The plan outsources key decisions to the future implementer.
- The plan validates only compilation or unit tests without behavioral proof.
- The plan uses jargon without definitions tied to this repository.
- The plan is stored outside `docs/exec_plans/active/` during active work, or remains there after all items are complete.
