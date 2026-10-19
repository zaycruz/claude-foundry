# foundry: Palantir Foundry for Claude Code

A Claude Code mod that lets Claude work in Palantir Foundry through the
[Orthanc](#orthanc) CLI, with the operator in control of every change.
Orthanc is the only path into Foundry: when it can't do something, the mod
says so instead of falling back to REST.

- **Two tools.** `orthanc_help` discovers Orthanc's command surface; `orthanc_cli`
  runs a command in agent mode and returns its `foundry-agent-v1` envelope.
  A waiting command (`repository checks wait`, `ontology branch-index-status
  --wait`, `sql wait`) runs as long as its own `--timeout` and `--publish-grace`
  plus a margin, from 300 s up to 1,920 s.
  Output over 20,000 chars is cut for the model, with row names, counts and the
  page token kept above the cut and the whole envelope written to a file.
- **An approval ladder** on every Foundry mutation, through the tools, Bash or a
  Palantir MCP server: `ask-always`, `allow-edits`, `auto` (a Haiku guard
  judges each mutation) and `yolo`. Destructive changes always ask; protected
  branches ask unless `yolo`; branch-scoped work needs an agent branch; calls
  naming the Compass root are denied; a call repeated three times is blocked.
- **A branch rule** that no approval mode can turn off: agent work happens on
  branches, never on a production main. Ontology writes must pass
  `--branch <global branch RID>`; dataset, stream and build writes must name a
  work branch; code goes to a work branch through `orthanc repository push` and
  a pull request. Branchless writes, writes to `main`/`master`, proposal
  merges and approvals, release tags, default-branch pushes, raw `git push` to
  a Foundry repository and Foundry writes outside Orthanc are blocked. Orthanc
  writes run only through `orthanc_cli`: Bash may read through Orthanc but not
  write, however the shell wraps the call. Text that only mentions Orthanc (a
  commit message, a PR body, an `echo`) is not a call.
- **FDE mode** (`/fde on`, or `/fde <goal>`): binds the session to one agent global branch.
  Ontology writes are pinned to it, each `--apply` needs a dry run of the same
  call first, and `/fde end` hands the branch back to the operator, still open.
- **Foundry context** in the system prompt (stack, ontology, projects, types,
  resources), and in the mod's own subagents.
- **Slash commands** for choosing that context, and **`/foundry`**, a live view
  of what is in context, like `/context` for Foundry.
- **Tracing** to Langfuse or any OTLP/HTTP collector: one trace per turn that
  touched Foundry, with each tool call, the gate's decision and token usage,
  redacted before it leaves the machine.
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
| `/scope [show\|clear\|ontology]`, `/approval [mode\|rules]`, `/recap` | Context, approval mode and guard rules, a two-paragraph recap |
| `/fde on`, `/fde <goal>`, `/fde goal <text>`, `/fde --branch <rid> [goal]`, `/fde`, `/fde resume`, `/fde end` | FDE mode: start on a new agent branch (with or without a goal) or adopt an open one, set the goal, show status, rebind after a restart, hand off |
| `/trace` | Trace export status, and whether the last Foundry trace reached Langfuse |

Every command has one name; there are no aliases. Every list command takes a
filter, and `clear`. `/link-type`, `/interface`, `/egress-policy`,
`/certificate` and `/automation` wait on Orthanc list commands and say so; the
mod never falls back to Foundry REST.

## FDE mode

`/fde on` puts the session in FDE mode: it creates `agent/fde-<timestamp>` as a
global branch on the selected ontology and binds the session, subagents
included, to it. `/fde <goal>` does the same with a goal, which names the branch
(`agent/fde-<goal>-<timestamp>`) and heads the prompt and the handoff;
`/fde goal <text>` sets or changes it later. `/fde --branch <rid> [goal]` adopts
an open agent branch instead. While bound:

- Ontology writes go to that branch. A write that needs a branch and names none
  gets it; a call that names any other global branch, another ontology,
  `--profile` or an abbreviated branch flag is refused. Dataset, stream and
  build writes keep the branch rule (a work branch, never main) but are not
  pinned to the global branch.
- The agent cannot create, close or merge global branches, or touch proposals,
  while bound; `global-branch add-repo` runs on the bound branch only.
- Plan, then apply: an `--apply` runs only after a clean dry run of the same
  call. The plan pins every file the call reads (`--*-file` values, `@file`,
  and any path-like argument that reads as a file) by SHA-256, checked again
  just before the call runs, and a file naming another global branch or
  ontology is refused. Each dry run licenses one apply: the apply takes it
  before running, so two identical applies in parallel cannot share it, and a
  refused apply, or one Orthanc rejects as a usage error, gives it back; any
  other failure keeps it spent, since Foundry may have changed. Directory
  arguments are not hashed, and a file over 20 MB is refused.
- The goal and branch go into the system prompt and a band above the prompt,
  and every turn is traced (not only the ones that touch Foundry).

`/fde end` prints a handoff (branch, applied writes, how to close it) and
leaves the branch open: merging or closing it is the operator's call. If a
session ends while bound, the next one offers `/fde resume`. The mode only
adds checks. The branch rule, the approval ladder and the destructive rule
judge every bound call as before, in every approval mode.

## Operator rules and auto mode

In `auto`, a Haiku guard judges each Foundry write. Give it your own rules in
`~/.claude/foundry/rules.md`, one per line. A project can add
`.claude/foundry-rules.md`; since a cloned repository can carry that file, its
rules may only make the guard stricter. Claude cannot edit either file, nor
read `~/.claude/foundry/`; `/approval rules` shows the rules. For
example:

```
Approve writes in the Sandbox project on agent/ branches.
Ask before any change to the Person or Organization object types.
```

`/approval rules` shows what the guard reads. The rules steer the guard only:
the branch rule and the destructive rule run first and cannot be loosened.

Claude Code's own auto-mode classifier judges tool calls before the mod sees
them, and by default it can refuse Foundry writes as changes to shared
resources. To let branch-scoped Foundry work run in auto mode, add an allow
rule under `autoMode.allow` in `~/.claude/settings.json` (keep the defaults from
`claude auto-mode defaults`, since a custom list replaces them):

```
Foundry Branch Work: Palantir Foundry writes made through the foundry Claude Code mod, and the
mod's foundry-* subagents doing them, when every write targets an agent work branch (an agent/
global branch or its ri.branch. RID, an agent- dataset branch, a non-default code branch, or a
resource this session created). The mod denies writes on main/master, merges and
default-branch pushes itself. Does NOT cover writes on main, master or the production
ontology, merges or approvals, permission changes, or deleting resources the session did
not create.
```

Run `claude auto-mode critique` after editing.

## Tracing

Each turn that touches Foundry (Orthanc tools, Orthanc in Bash, a gated call, a
Palantir MCP tool) becomes one OTLP trace: the prompt and answer, a span per
tool call with the gate's outcome and reason, and a generation span with the
model and token usage. Only Foundry calls carry their input and output; other
tools in the turn are named, not shown. Turns in one Claude Code session share
a Langfuse session. Nothing is exported until you configure an endpoint, in the
environment or in `~/.claude/foundry/otel.env`. The mod reads that file once
per session as `KEY=value` lines (it never runs it), and Claude can neither
read nor edit it. A value can be a 1Password reference, resolved with
`op read`, so the file holds no keys:

```sh
# Langfuse
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY="op://Vault/Langfuse/public_key"
LANGFUSE_SECRET_KEY="op://Vault/Langfuse/secret_key"
# or any OTLP/HTTP collector
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://collector.example.com/v1/traces
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20...
```

Prefer the file to exported variables: keys in the session's environment are
visible to any shell command Claude runs. `FOUNDRY_OTEL=off` turns tracing
off, `FOUNDRY_OTEL=all` exports every turn, `FOUNDRY_OTEL_TOOL_IO=off` drops
tool input and output, and `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES`
set the resource. Before export, values under sensitive keys (tokens, RIDs,
hosts, names), inside Orthanc envelopes too, are replaced, and tokens,
credentials, RIDs, emails, phone numbers, private IPs and internal hostnames
are redacted; add your own domains with `FOUNDRY_OTEL_REDACT_DOMAINS=...`.
`/trace` shows the collector's host, never a header. Export is fire-and-forget
and never changes what a tool call does.

## Develop

```
claude plugin validate .
claude plugin test .
```

`hooks/*.test.ts` cover the ladder, parity, the context view and trace export. For an E2E run
against your own stack, record real Orthanc output and replay it:

```
FOUNDRY_E2E_PROFILE=<profile> FOUNDRY_E2E_PROJECT=<project rid> \
FOUNDRY_E2E_ONTOLOGY=<ontology rid> ./scripts/record.sh
```

That writes `hooks/fixtures.local.ts`, which `hooks/e2e.local.test.ts` replays.
Both stay out of git: they hold your stack's data.

## License

MIT
