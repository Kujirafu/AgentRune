# Project Memory Policy

## Purpose
This project uses two different documentation layers:

- Public repository documentation for information that should ship with the AGPL project
- Local project memory for agent workflow, working context, and operational notes that should stay on the developer machine

The goal is to keep development efficient without accidentally treating private agent memory as public repository content.

## Public vs Local

### Public, tracked in git
Put information in tracked files when it is part of the software project itself or should be available to repository users, contributors, and AGPL source recipients.

Typical public destinations:
- `README.md` for product overview and setup
- `docs/` for architecture, workflows, design notes, and contributor-facing guidance
- Source comments for code-local rationale
- Tests when behavior should be documented as executable expectations

Examples of content that should usually be public:
- Build and release instructions that are needed to run or modify the software
- Architecture decisions that affect contributors
- Security fixes and mitigations relevant to shipped code
- Stable workflow documentation for contributors

### Local, not tracked in git
Keep agent working memory in `.agentrune/`.

This includes:
- Session-oriented notes
- Temporary investigation context
- Private operating notes
- Personal workflow reminders
- Local screenshots, uploads, and session state
- Cross-agent memory that helps active development but is not intended as public documentation

## AGPL Boundary
AgentRune is licensed under AGPL-3.0. For this project, the safe default is:

- Ship source code and public project documentation in the repository
- Keep `.agentrune/` as local project memory unless there is a deliberate decision to publish specific content

`.agentrune/` should not be treated as the canonical public source of project documentation.

## Recommended Workflow
1. Read `.agentrune/agentlore.md` first as the memory index.
2. Use the index to open only the context section relevant to the current task. Do not load every memory file by default.
3. Do the work.
4. Write short-term or operational knowledge back into the matching `.agentrune/context/*.md` section.
5. If a finding should be public and durable, promote it into tracked docs such as `README.md`, `docs/`, code comments, or tests.

## Built-in Tooling
The bundled CLI and desktop install support this workflow directly:

- Agent session startup initializes `.agentrune/agentlore.md`, `.agentrune/context/*.md`, and `.agentrune/rules.md` when needed.
- `agentrune memory init` prepares or migrates the local memory structure.
- `agentrune memory route` and `agentrune memory search` help route the agent to the right section before reading.
- `agentrune mcp` exposes memory tools that operate on `AGENTRUNE_PROJECT_CWD` or the current working directory, so external agents can use the same index-first workflow.

## Current Memory Structure
Local project memory is organized as:

- `.agentrune/agentlore.md` as the index
- `.agentrune/context/stack.md`
- `.agentrune/context/decisions.md`
- `.agentrune/context/lessons.md`
- `.agentrune/context/security.md`
- `.agentrune/context/changelog.md`
- `.agentrune/context/bugs.md`

This structure is intentionally local-first. It supports agent continuity without forcing every working note into the public AGPL repository.
