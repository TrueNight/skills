# <Short, action-oriented description>

This ExecPlan lives in `docs/exec_plans/active/` while work is ongoing. Interpret that path relative to the git repository root, or the project root if no git root is available. Move it to `docs/exec_plans/archive/` only after every remaining `Progress` item is complete and the implementation has been delivered.

Filename: `YYYY-MM-DD-short-plan-name.md`

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` up to date as work proceeds.

## Purpose / Big Picture

Explain what someone gains after this change, what they can do that they could not do before, and how they can observe it working.

## Progress

- [x] (2026-04-16 12:00Z) Example completed step.
- [ ] Example incomplete step.
- [ ] Example partially completed step (completed: X; remaining: Y).

## Open Questions

Optional. Include this section while unresolved questions, ambiguities, or blockers exist. Remove the section once all questions are resolved. When a question is answered, delete its entry here and add the committed choice to `Decision Log`.

- OQ-001:
  Question: What is the unresolved question or ambiguity?
  Context: Why this is open right now and what depends on it.
  Blocking: What downstream work is blocked until this resolves (or "none").
- OQ-002:
  Question: Example of a second open question.
  Context: Background needed to evaluate options.
  Blocking: none

## Surprises & Discoveries

- Observation: Record unexpected behavior, bug, constraint, or performance finding.
  Evidence: Add a concise proof snippet, command output, log line, or measurement.

## Decision Log

- Decision: Record a meaningful implementation or scope choice.
  Rationale: Explain why this path was chosen over alternatives.
  Date/Author: 2026-04-16 Name

## Outcomes & Retrospective

Summarize what was achieved, what remains, and what was learned at a milestone boundary or at completion. When the work is finished, note that all implementation items are done and the file is ready to move from `docs/exec_plans/active/` to `docs/exec_plans/archive/`.

## Context and Orientation

Describe the repository areas relevant to this task as if the reader knows nothing. Name the key files, modules, services, tests, and commands by repository-relative path. Define any non-obvious term immediately.

## Plan of Work

Describe the implementation sequence in prose. For each material edit, name the file and the function, module, or section to change. Explain why the edit is needed and what will exist afterward.

Use narrative milestones when the work is large enough to benefit from staged delivery. Each milestone should say what new behavior will exist, how to test it, and what success looks like.

## Concrete Steps

List the exact commands to run, including the working directory. When useful, include short indented examples of the expected output.

    cd /repo/path
    <command>
    <expected output snippet>

## Validation and Acceptance

Describe the end-to-end proof path. State the exact tests, requests, UI actions, or scripts to run, and the outputs or behaviors that confirm success. Phrase acceptance as something a human can observe.

## Idempotence and Recovery

Explain which steps are safe to repeat, what to do if a step fails midway, and how to roll back or continue safely after interruption. Include how to safely move the finished plan into `docs/exec_plans/archive/` without losing the final state recorded in the document.

## Artifacts and Notes

Include only the most important supporting snippets, transcripts, or file excerpts that help a novice confirm progress.

Log each planning check here: what was run, its result, and the commit SHA it ran on.

## Interfaces and Dependencies

Name the libraries, modules, services, types, interfaces, and function signatures that must exist or change. Be explicit about dependency choices and the reason each dependency is needed.

## Change Log

- 2026-04-16: Created or revised the plan. Reason: explain what changed and why.
