# Architecture decision records

Each file records one decision in the classic format: the context that forced a
choice, the decision taken, and the consequences accepted with it. They describe
decisions already embodied in the code, written down after the fact so the
reasoning survives; they are not proposals.

A record is immutable once accepted. If a decision is reversed, add a new record
that supersedes it and mark the old one superseded rather than editing it.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-cache-first-api-design.md) | Cache-first API design, with upstream fetch on miss | accepted |
| [0002](0002-file-based-leie-pipeline.md) | Load the OIG LEIE from the published flat file, not from an API | accepted |
| [0003](0003-jsonb-populate-recordset-loaders.md) | One insert pattern for every bulk loader, plus a self-verifying count rule | accepted |
| [0004](0004-open-sanctions-state-lists.md) | Source state Medicaid exclusion lists from the OpenSanctions mirror, flag overlap rather than dedupe across sources | accepted |
