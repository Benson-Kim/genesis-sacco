# docs/diagrams — architecture & threat-model diagrams (P-DIAG series)

Conventions for every diagram in this directory (BUILD_PROMPTS
PHASE B2 common rules):

- **Diagrams-as-code, Mermaid preferred.** One file per diagram,
  kebab-case names. A diagram lives either in a standalone `.mmd` file
  or inside a ` ```mermaid ` fenced block of a companion `.md` document
  (the companion carries the derivation, code citations and arguments
  the diagram alone cannot).
- **Authoring SHA.** Every diagram file starts with a header comment
  citing the `main` commit SHA it was authored against. Diagrams depict
  main **as-built** at that commit; not-yet-built flows may appear only
  with an explicit `PLANNED (Pn)` / `INCOMING (Pn)` label and must be
  flipped to as-built by the executing prompt's MR (v1.2 rule 11).
- **No invented structure.** Every box and edge must be traceable to a
  module, table, lock, or route on main; the source file is cited next
  to the element (in the companion table or a `%%` comment).
- **Drift rule (v1.2 rule 11).** Any MR that changes a diagrammed flow,
  table, lock-graph edge, or trust boundary MUST update the affected
  diagram(s) in the same MR. A stale diagram is a rejected MR.
- **CI validation.** The `docs:diagrams` job (`.gitlab-ci.yml`) renders
  every standalone `.mmd` file AND every ` ```mermaid ` block found in
  `docs/diagrams/*.md` with mermaid-cli. It runs only when
  `docs/diagrams/**` changes. A diagram that does not render is a red
  pipeline — never bypass it by moving the diagram out of this
  directory.

## Index

| Diagram | Prompt | Status |
|---|---|---|
| [`lock-order.md`](lock-order.md) — **authoritative lock-ordering DAG** (the single authority for every lock-order statement; v1.2 rule 11) | P-DIAG.0 | as-built |
| [`c4-context.md`](c4-context.md) — C4 L1 system context (clients/providers marked PLANNED) | P-DIAG.1 | as-built |
| [`c4-container.md`](c4-container.md) — C4 L2 containers (layers, workers, migration runner, store properties) | P-DIAG.1 | as-built |
| [`c4-component.md`](c4-component.md) — C4 L3, one diagram per API router group; spot-check: [`c4-spot-check.py`](c4-spot-check.py) | P-DIAG.1 | as-built |

P-DIAG.2–.5 (ERD, DFDs, STRIDE, sequence patterns) land here as
their prompts execute.
