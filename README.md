# foundry: Palantir Foundry for Claude Code

A Claude Code mod that lets Claude work in Palantir Foundry through the
[Orthanc](#orthanc) CLI, with the operator in control of every change.
Orthanc is the only path into Foundry: when it can't do something, the mod
says so instead of falling back to REST.

- **Two tools.** `orthanc_help` discovers Orthanc's command surface; `orthanc_cli`
  runs a command in agent mode and returns its `foundry-agent-v1` envelope.
  Output over 20,000 chars is cut for the model, with row names, counts and the
  page token kept above the cut and the whole envelope written to a file.
- **An approval ladder** on every Foundry mutation, through the tools, Bash or a
  Palantir MCP server: `ask-always`, `allow-edits`, `auto` (a Haiku guard
  judges each mutation) and `yolo`. Destructive changes always ask; protected
  branches ask unless `yolo`; branch-scoped work needs an agent branch; calls
  naming the Compass root are denied; a call repeated three times is blocked.
- **Foundry context** in the system prompt (stack, ontology, projects, types,
  resources), and in the mod's own subagents.
- **Slash commands** for choosing that context, and **`/foundry`**, a live view
  of what is in context, like `/context` for Foundry.
- **Agents** (`foundry-scout`, `foundry-builder`, `foundry-reviewer`,
  `foundry-oracle`) and **skills** for the Foundry delivery lifecycle.

## Install

### 1. Orthanc (required)

The mod does all of its Foundry work through the `orthanc` binary. Install the
latest release and set up a profile for your stack:

```sh
curl -fsSL https://github.com/zaycruz/orthanc/releases/latest/download/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
orthanc --version
orthanc onboarding        # skipped by the installer if a profile already exists
```

The mod runs `orthanc` from `PATH` (or `ORTHANC_BIN`). Add more stacks with
`orthanc configure profile create`. Tokens stay in the macOS Keychain and never
pass through Claude: `/auth` prints the command for you to run in your own
terminal.

### 2. The mod

```
/plugin marketplace add zaycruz/claude-foundry
/plugin install foundry@claude-foundry
```

Or load a checkout for one session: `claude --plugin-dir ./claude-foundry`.
Function hooks must be enabled (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
`/onboard` checks that Orthanc, the profile and the credentials all work.

## Commands

| Command | Does |
| --- | --- |
| `/foundry` | The Foundry resources in context: counts, items, clear buttons, prompt size |
| `/open` | Stack, then ontology, then projects |
| `/onboard`, `/mcp-status` | Check orthanc, profiles, stack, credentials, context |
| `/auth [profile]` | How to store credentials, and whether they work |
| `/profile`, `/ontology`, `/project` | Choose the stack, ontology, projects |
| `/object-type`, `/action-type` | Ontology types in scope |
| `/folder` `/dataset` `/media-set` `/repository` `/contour` `/source` `/developer-console` `/aip-chatbot` | Compass resources in scope |
| `/media-item`, `/objects`, `/function`, `/language-model`, `/permission`, `/search` | Lookups added to context |
| `/scope [show\|clear\|ontology]`, `/approval [mode]`, `/recap` | Context, approval mode, a two-paragraph recap |

Every command has one name; there are no aliases. Every list command takes a
filter, and `clear`. `/link-type`, `/interface`, `/egress-policy`,
`/certificate` and `/automation` wait on Orthanc list commands and say so; the
mod never falls back to Foundry REST.

## Develop

```
claude plugin validate .
claude plugin test .
```

`hooks/*.test.ts` cover the ladder, parity and the context view. For an E2E run
against your own stack, record real Orthanc output and replay it:

```
FOUNDRY_E2E_PROFILE=<profile> FOUNDRY_E2E_PROJECT=<project rid> \
FOUNDRY_E2E_ONTOLOGY=<ontology rid> ./scripts/record.sh
```

That writes `hooks/fixtures.local.ts`, which `hooks/e2e.local.test.ts` replays.
Both stay out of git: they hold your stack's data.

## License

MIT
