# Plan: Parallel review and planning task, Provider Intelligence Platform

Stage 1 (parallel, 4 subagents):
1. CODE_REVIEW.md — adversarial SQL/edge-case/performance review of analyticsService.js (coder/reviewer subagent).
2. SECURITY_REVIEW.md — HIPAA-oriented hardening backlog based on CORRECTIONS.md + FRONTEND_SPEC.md API surface (reviewer).
3. PROMPT_REVIEW.md — red-team resume-prompt.md, exact wording fixes (reviewer).
4. V2_ROADMAP.md — user stories + phased weekend roadmap (plan).

Stage 2: verify all four files exist in /mnt/agents/output, integrate, deliver.

Constraints: findings by severity; say "insufficient materials" where applicable; no code rewrites in reviews; no em-dashes anywhere (user style).
