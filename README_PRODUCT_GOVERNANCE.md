# Talvia Product Governance Package

This package gives Talvia persistent product memory inside the repository.

It is designed for:

- Claude Code;
- Codex;
- future coding agents;
- human developers;
- contractors;
- technical cofounders.

The goal is to prevent product drift when chat context resets or when new ideas appear.

## Install

Place the files at the repository root exactly like this:

```text
talvia/
├── AGENTS.md
├── CLAUDE.md
├── README_PRODUCT_GOVERNANCE.md
└── docs/
    └── product/
        ├── TALVIA.md
        ├── PRINCIPLES.md
        ├── ARCHITECTURE.md
        ├── ROADMAP.md
        └── DECISIONS.md
```

Commit them to Git.

Recommended commit:

```text
docs: add Talvia product governance and agent context
```

Because they live in Git, every future local clone, coding agent, or developer can read the same product definition.

## Source of truth

`docs/product/TALVIA.md` is the canonical product definition.

The other files operationalize it.

## Agent usage

Before meaningful product work, agents should read:

1. `AGENTS.md`
2. `docs/product/TALVIA.md`
3. `docs/product/PRINCIPLES.md`
4. `docs/product/ARCHITECTURE.md`
5. `docs/product/ROADMAP.md`
6. `docs/product/DECISIONS.md`

Claude Code should also read `CLAUDE.md`.

## Maintenance

When the product intentionally changes:

- update `TALVIA.md` if the definition changes;
- update `PRINCIPLES.md` if decision rules change;
- update `ARCHITECTURE.md` if domain boundaries change;
- update `ROADMAP.md` when priorities change;
- add a durable record to `DECISIONS.md`.

Do not let major decisions exist only inside chat history.
