# foundry: Palantir Foundry for Claude Code

A Claude Code mod that lets Claude work in Palantir Foundry through the
[Orthanc](#orthanc) CLI, with the operator in control of every change.
Orthanc is the only path into Foundry: when it can't do something, the mod
says so instead of falling back to REST.

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

Each plugin release names the orthanc versions it supports: `min_orthanc` and
`orthanc_checked` in `.claude-plugin/plugin.json`. When the installed orthanc is
older or newer, the session's first lines say so and name the command to run
(`orthanc update --apply`, or `claude plugin update foundry@claude-foundry`).
Reads still run either way, and writes the manifest marks for approval still ask.
How a release moves these fields: [docs/RELEASE.md](docs/RELEASE.md).

The mod runs `orthanc` from `PATH` (or `ORTHANC_BIN`). Add more stacks with
`orthanc configure profile create`. Tokens stay in the macOS Keychain and never
pass through Claude: `/auth` prints the command for you to run in your own
terminal. Two commands are `read-only` in Orthanc's agent manifest and the mod
still refuses them in every mode, because their job is to hand you a value:
`orthanc repository git-credential get` prints the active profile's token
(`password=…`), and `orthanc compute env get` writes one environment variable's
value to a new file or to the clipboard. Run those in your own terminal.

Two more are `read-only` because nothing on Foundry changes, and their flags say
the call writes **this machine**: `repository clone <rid> <dir> --force` deletes
a non-empty target folder before it clones, and `dev-console sdk install
--yes|--target <dir>` runs `npm` or `pip` install of the packages the
application's SDK definition names. The mod judges those two calls as writes:
they go through the approval ladder (the `--force` clone asks in every mode but
yolo) and Bash runs neither. A plain clone, and either command with `--dry-run`,
is still a read.

### 2. The mod

```
/plugin marketplace add zaycruz/claude-foundry
/plugin install foundry@claude-foundry
```

Or load a checkout for one session: `claude --plugin-dir ./claude-foundry`.
Function hooks must be enabled (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
`/onboard` checks that Orthanc, the profile and the credentials all work.

## What it does

- **Two tools.** `orthanc_help` discovers Orthanc's command surface; `orthanc_cli`
  runs a command in agent mode and returns its `foundry-agent-v1` envelope.
  A waiting command (`repository checks wait`, `ontology
  branch-index-status --wait`, `sql wait`, `devops draft publish
  --wait`, `marketplace installation create|upgrade|uninstall --apply`,
  `marketplace job cancel --wait`, `functions execute`, `models deployment get
  --wait`, `ai-fde run --apply`) runs as long as Orthanc bounds its own wait —
  one of `--timeout`, `--timeout-seconds`, `--publish-grace`,
  `--readback-timeout`, `--time-budget-seconds`, plus a wait Orthanc keeps as a
  constant with no flag for it (the 900 s a draft takes to finalise; the 780 s
  of a Marketplace install; the 600 s an uninstall polls its delete job; 370 s
  around `ai-fde run`) — and a margin, from 300 s up to 2,290 s (more for a
  command whose own defaults need more). A call that would need more is refused
  before it starts and before any approval prompt, naming the flag to make
  smaller and the largest value of it that fits (for `ai-fde run`, also
  `--detach`). A flag that only caps one HTTP request — `--timeout-seconds` on
  `search`, `update` or `functions` — lengthens the timer and never refuses. A
  call stopped from outside its timer says `reason: cancelled`; a stop by the
  timer says `reason: timeout`. A write stopped by either is reported as an
  unknown mutation: reconcile before you retry it. The same
  wait typed into `Bash` gets that budget too: the call's `timeout` is raised to
  what its own flags ask for — the waits of the Orthanc calls in one command,
  added up when the shell can run them one after another (`a && b`, `;`, a counted
  `for` loop, and `a || b`, because a wait that times out exits 1 and the retry
  runs), the larger of the two only where they genuinely cannot both happen (a
  pipeline, the arms of a `case`), nothing for a job left running by `&` — up to the
  shell's own limits (`BASH_DEFAULT_TIMEOUT_MS` 120 s, `BASH_MAX_TIMEOUT_MS` 600 s
  by default). A line that cannot fit is refused before it starts and given
  `orthanc_cli`, a `--timeout` that fits, and `run_in_background: true`; a line
  the guard cannot price (arguments inside a substitution, a `--timeout` holding a
  variable) is left exactly as it came.
  Output over 20,000 chars is cut for the model, with row names, counts and the
  page token kept above the cut and the whole envelope written to a file.
- **An approval ladder** on every Foundry mutation, through the tools, Bash or a
  Palantir MCP server: `ask-always`, `allow-edits`, `auto` (a Haiku guard judges
  each mutation) and `yolo`. Outside `yolo`, a destructive change asks, as do
  release tags, protected branches and an AI FDE run (`ai-fde run --apply`, whose
  worker writes with its own tools for the whole run; `yolo` runs it with no ask),
  and a call repeated three times is blocked. A
  change is destructive when its command name, or one of its flags, says something is
  left gone or overwritten — `marketplace installation uninstall`,
  `project remove-orgs`, `streams stream reset`, `alias clear` — or when it is
  given `--force`, or when the value of one of its flags is an act — one Orthanc
  lists among that flag's accepted values (`--transaction-type DELETE`), or one
  spelled in caps the way Orthanc spells its enumerated values.
  The rule reads the name and anything that looks like a flag. A positional and a value
  that names no act ask nothing, such as `--mode keep-outputs` or
  `--branch delete-me`. An argument that starts with a hyphen looks like a flag, so it
  asks: reading too much costs a prompt, reading too little costs the ask. The words,
  and what each one leaves, are `DESTRUCTIVE_WORDS` in `hooks/policy.ts`; the
  approval prompt builds its own wording from that table. In `yolo` only a write
  on main asks: destructive writes run at once, the loop guard is off, and a
  promotion (merging, accepting or approving a proposal, `global-branch
  deploy`, `repository pull-request merge`) runs with no ask, since it lands
  through a proposal, never directly on main. A
  release tag with no `--branch <global branch RID>` is a release on main and
  asks in `yolo` too. A write that Orthanc's agent manifest marks
  `operator_approval` (turning branch protection off, removing a required
  check) asks in every mode; in `yolo` it runs with no ask only when the
  entry's `operator_approval_scope` shows it lands on one global work branch
  (`global-branch roles set`, `remove-resources`, `remove-repo` with a branch
  RID). A missing or unreadable scope asks. A write naming `main`, `master` or `HEAD` as its branch (any
  spelling: `--branch=main`, `-b master`, `-bmain`, or as a positional, as in
  `dataset branches delete <dataset> master` or `branch-protection repo
  unprotect <repo> main`), and `workshop module publish`, which works on main
  only, run only when the operator approves
  them, in every mode; with no one to ask they are refused. So does
  `ontology scenario create --apply` when `--base-branch` does not name one
  global branch RID: an Ontology scenario is a what-if fork, and its base is
  main unless the call names a branch.
  `orthanc update` never runs through `orthanc_cli`, in any mode: it replaces
  the Orthanc binary the command list and its `operator_approval` marks were
  read from, and `--plugin` updates this plugin. `claude plugin
  update|uninstall|disable` naming this plugin is refused in Bash for the same
  reason: it replaces the code these rules are written in. The operator updates
  Orthanc and the plugin in their own terminal.
  Branch-scoped work needs an agent branch; calls naming the Compass root are
  denied. A command whose manifest entry names a credential the operator types —
  by `input`, or by `credential_store`, the store it writes — never runs, in any
  mode, through `orthanc_cli` or Bash, and is refused before the ladder can ask
  (`auth store`, `configure profile create`, `configure configure`,
  `onboarding`). `orthanc_help` marks those commands `operator-only` and `/auth`
  lists them for the operator's own terminal. The two entries that only clear the
  store (`auth delete`, `configure delete`) name it too and type nothing, so the
  ladder judges them as the deletes they are.
- **A branch rule** that no approval mode can turn off: agent work happens on
  branches, never on a production main. Ontology writes must pass
  `--branch <global branch RID>`; dataset, stream and build writes must name a
  work branch; code goes to a work branch through `orthanc repository push` and
  a pull request. Branchless writes, `--allow-default-branch`,
  default-branch pushes, raw `git push` to a Foundry
  repository and Foundry writes outside Orthanc are blocked. A MCP tool counts as
  such a write when its server name or its tool name says Palantir or Foundry, in any
  case or spelling (`mcp__palantir__…`, `mcp__Palantir__…`, `mcp__foundry_tools__…`,
  `mcp__palantirFoundry__…`, `mcp__tools__foundry_delete_object`), not only the exact
  name `mcp__palantir__`. A tool
  whose name reads with plain separated words (`list_objects`, `get-object`,
  `search data`) still runs; a camelCase read (`listObjects`) is refused, because
  the same shape hides a second verb. A name carrying both
  a read verb and a write verb (`view_branch_and_revoke_protection`) counts as a
  write, and one whose name the guard cannot read is refused. A write naming
  `main`/`master` asks the operator (above). Promotions — proposal merges,
  accepts and approvals, `global-branch deploy`, `repository pull-request
  merge` — are not blocked: they land through a proposal, never directly on
  main, so in `yolo` they run with no ask and elsewhere they follow the
  ladder (the manifest's `operator_approval` marks ask). The one ontology write
  whose branch spelling is not `--branch` is `ontology scenario create`: it takes
  `--base-branch <global branch RID>`, and a `--apply` without one asks the
  operator instead of being blocked, because a scenario based on main is a
  legitimate call the operator may want to make. Writes whose branch defaults to
  main or master must name a branch too: connectivity imports, repository
  imports, `dataset create-from-csv`, `workshop module update`, `automate
  update`/`pause`/`resume` and the `pipeline` sandbox, edit, publish and
  deploy commands. A schedule's build action (`orchestration schedules
  create`/`replace`) must name its `branchName`. Before `orchestration schedules
  run`/`unpause` or `connectivity import run`, the guard reads the stored
  schedule or import: if it builds main, names no branch, or cannot be read,
  the call asks the operator. A release tag
  (`repository tag create --apply`) is not blocked: it asks the operator,
  naming the tag, the commit, the repository and the Foundry branch if any;
  in `yolo` only a tag on a global branch RID runs with no ask. Orthanc
  writes run only through `orthanc_cli`: Bash may read through Orthanc but not
  write, however the shell wraps the call. The Bash guard decides "this runs
  Orthanc" from the command word of each simple command (assignments and
  wrappers resolved), never from a substring anywhere in the line: the word in
  a quoted argument, a repo name (`zaycruz/orthanc`), a path, a flag value, a
  heredoc body or a JSON payload is data, not a call. Only a command word that
  is Orthanc — plain, a path to it, or `$ORTHANC_BIN` — is one, however it is
  spelled (after `env`/`sudo`/`timeout`/`xargs`, in a pipeline, in `$(…)`, via
  `bash -c`, over `ssh`); where the guard cannot tell (eval, a variable as the
  command word, code fed to a shell or interpreter) it refuses. Text that only
  mentions Orthanc (a commit message, a PR body, an `echo`) is not a call.
- **FDE mode** (`/fde on`, or `/fde <goal>`): binds the session to one agent global branch.
  Ontology writes that name no branch get it added, a write aimed directly at
  main or master is the one thing the mode refuses, and `/fde end` hands the
  branch back to the operator, still open.
- **Foundry context** in the system prompt (stack, ontology, projects, types,
  resources), and in the mod's own subagents.
- **Slash commands** for choosing that context, and **`/foundry`**, a live view
  of what is in context, like `/context` for Foundry.
- **Tracing** to Langfuse or any OTLP/HTTP collector: one trace per turn that
  touched Foundry, with each tool call, the gate's decision and token usage,
  redacted before it leaves the machine.
- **Agents** (`foundry-scout`, `foundry-builder`, `foundry-reviewer`,
  `foundry-oracle`) and **skills** for the Foundry delivery lifecycle.

## Commands

| Command | Does |
| --- | --- |
| `/foundry` | The Foundry resources in context: counts, items, clear buttons, prompt size |
| `/open` | Stack, then ontology, then namespace, then projects |
| `/onboard`, `/mcp-status` | Check orthanc, profiles, stack, credentials, context |
| `/auth [profile]` | How to store credentials, and whether they work |
| `/profile`, `/ontology`, `/namespace`, `/project` | Choose the stack, ontology, namespace, projects |
| `/object-type`, `/action-type`, `/link-type`, `/interface` | Ontology types in scope |
| `/folder` `/dataset` `/media-set` `/repository` `/contour` `/source` `/developer-console` `/aip-chatbot` `/automation` | Compass resources and automations in scope |
| `/media-item`, `/objects`, `/function`, `/language-model`, `/permission`, `/search` | Lookups added to context |
| `/scope [show\|clear\|ontology]`, `/approval [mode\|rules]`, `/recap` | Context, approval mode and guard rules, a two-paragraph recap |
| `/fde on`, `/fde <goal>`, `/fde goal <text>`, `/fde --branch <rid> [goal]`, `/fde`, `/fde resume`, `/fde end` | FDE mode: start on a new agent branch (with or without a goal) or adopt any open one, set the goal, show status, rebind after a restart, hand off |
| `/trace` | Trace export status, and whether the last Foundry trace reached Langfuse |

Every command has one name; there are no aliases. Every list command takes a
filter, and `clear`. `/egress-policy` and `/certificate` wait on Orthanc list
commands and say so, naming the bead; the mod never falls back to Foundry REST.
`/link-type` and `/interface` run `ontology link-type-list` and `ontology
interface-list` on the ontology in scope. While FDE mode is bound to that
ontology they read its branch (`--branch`, the way `ontology definition` reads a
branch), so an FDE session picks the link types and interfaces of its own branch,
and the listing names that branch; otherwise they read the main branch.
The pick shows what each link joins and which object types implement each
interface, and names the RID of every pick whose name another pick shares.
`/automation` runs `automate list` under the selected projects, or under the
namespace's, or every space when neither is picked, and passes its argument to
`--name`. When one of those listings fails, the result says how many did, and a
short walk is never picked from on its own.

`/namespace` scopes the context to one Compass namespace (orthanc's space):
`/project` and the Compass pickers list only its projects, `/search` stays under
its path, and the prompt tells Claude to do the same. Choosing a different
namespace clears the projects and Compass resources picked before; choosing
the same one or clearing it keeps them. An `orthanc_cli` write that passes
`--profile` is refused in every mode: orthanc reads the last `--profile` it is
given, so the write would leave the stack `/profile` picked. A read may name
another stack. `configure use` and `configure set-default` are refused too,
because they change the stack a later session starts on. A stack the operator
marked read-only (orthanc v0.7.8: `orthanc configure profile set <name>
--read-only`, also `configure profile create --read-only`) runs no write in any
approval mode: `orthanc_cli` reads the profile's `read_only` mark from
`configure list` and refuses before the approval ladder and before orthanc
starts, naming the exact call and the mark. What does run is what orthanc's own
gate runs: reads, plans and local commands, so an agent can still preview a
change on such a stack. A plan is the same call with `--apply` left off: it is a
plain flag, and leaving it off is how orthanc asks for a plan. A mutation whose manifest entry has no `--apply` flag writes the
moment orthanc starts it, so it is refused, and the refusal says so instead of
telling the agent to plan. `configure profile set <name> --no-read-only`, which
clears the mark, asks the operator in every mode, `yolo` included, whoever the
mark is on: the question names the stack the call names. The plugin writes
nothing into orthanc's config directory (`~/.config/foundry`, or
`$XDG_CONFIG_HOME/foundry`), where `profile-settings.json` keeps the mark. File
writes there are refused. A shell command that names the store, a file in it, or a
directory above it (`~/.config`, `~`) runs only when it is a known reader: `cat`,
`ls`, `stat`, `wc`, `head`, `tail`, `grep`, `jq`, `diff`, a checksum, `echo`,
`printf`, `test`, a text filter such as `cut`, `tr` or `sort`, a `find` that uses
only tests and print actions, or a `git` subcommand that writes only the
repository (`log`, `diff`, `status`, `add`, `commit`, and the like). The reader
must be called by its bare name or from a standard `bin` directory (not
`/tmp/cat`), with no variable set for it (`GIT_EXTERNAL_DIFF=…`, `LESSOPEN=…`,
`PATH=…`), and with no flag that writes a file or runs a program, in any
abbreviation GNU accepts (`sort -o`, `sort --out=`, `less -o`, `less +cmd`,
`find -fprint`, `git diff --ou=`, `git -c`). Everything else is refused. That
includes a command the list does not know (`curl -o`, `wget -O`, `ex`, `vim -es`,
`gio trash`, `sqlite3`), a wrapper (`sudo`, `env`, `nice`, `time`, `xargs`), and a
redirect into the store, with or without a command word (`> profile-settings.json`
after a `cd`). When the store, or a path in it, appears anywhere on the line,
including in a heredoc or a here-string, every command on the line must be a
reader. A pipe, a loop, `read`, `mapfile` or a command substitution can carry the
path from one command to another
(`ls -d <store> | while read d; do rm -rf "$d"; done`). A directory above the store
has the same rule when a pipe, a command substitution or a loop's words carry it
(`echo ~/.config | xargs rm -rf`, `for d in ~; do rm -rf "$d/.config"; done`).
Elsewhere on the line it does not, so `cd ~ && npm test` runs. A redirect to a
path the guard cannot read (`: > "$f"`) counts as a write. The
guard spells each word as bash would, in these ways. It expands globs on any part of the
path, with bash's whole bracket grammar (`[!F]`, `[[:alpha:]]`, `[=f=]`, a leading
`]`), matched case by case and also case-free for macOS. It reads extglob groups
(`+(f)oundry`, `!(x)`) as any text. It expands every brace sequence bash expands,
in any direction, step or padding (`foundr{a..z}`, `foundr{z..a..2}`, `{01..10}`).
It joins quoted pieces (`fo""undry`, `foundr$'y'`, `foundr$"y"`), drops backslashes,
joins a word across a backslash-newline (`foun\<newline>dry`) as bash does, and
expands every `~` form (`~`, `~+`, `~-`, `~login`). It substitutes `$HOME`,
`$XDG_CONFIG_HOME`, `$PWD`, `$OLDPWD`, `$(pwd)` and the variables the line sets,
also with bash's operators (`${HOME:-x}`, `${HOME%/}`). It follows indirect ones
(`${!h}`, `${!h:-x}`, `${!h%/}` with `h=HOME`), a nameref (`declare -n r=HOME`,
`local -n`, `typeset -n`), including a target assigned later, and variables set by
`read` from a here-string or heredoc or built by `printf -v`, with its options
read as bash reads them (`printf -v d -- …`). The default of an unknown variable
(`${NOPE:-$HOME/.config/foundry}`) counts as a path it can name. Inside a longer
word, these count as any text there, the empty text included: an unknown variable,
a positional parameter, a command substitution, and an operator the guard does not
compute exactly (a substring, a replacement, a case change, a pattern trim). So
`foundr${NOPE}y`, `foundr$1y`, `foundr$(:)y`, `foundr$(tr a y <<< a)` and
`foundr${HOME:0:0}y` all name the store. A
substitution that runs `echo`, `printf` or `pwd` counts as what it prints. It resolves relative names after a `cd`, and reads the
path inside `bash -c '…'`. A `find ... -delete` whose name pattern cannot match the
mark (`find ~ -name "profile-*.png" -delete`) still runs. The guard reads the
command line, not a running shell, so it has these limits. It does not catch a path
built at run time inside a script
(`python3 -c "os.remove(os.path.join(os.environ['HOME'], ...))"`). It does not catch
a whole word that is a variable set outside the line (`rm -rf "$f"`, `rm -rf $STORE`)
or a command substitution whose output only the run shows (`rm -rf $(cat list)`).
It also does not catch a path that a file the line reads supplies
(`xargs rm -rf < list`, `source script.sh`). The rule also refuses more than it must: a command that is not a reader
and only mentions the store (`npm run x -- --note ~/.config/foundry`) is refused,
and so is a `cp` of the store out. A brace
list past 4096 names is read as a shape rather than enumerated, so a command that
would remove thousands of directories is refused even when
none of its names is the store. A stack `configure list` says nothing about is unknown, not
writable: the write goes to the operator and never runs blind, while reads and
plans are not held up. `/profile` and `orthanc_help` say which stacks are
read-only. `/namespace` steers discovery only; the gate does not deny writes
outside it, in FDE mode or out (FDE mode keeps the namespace in scope and locks
the picker until `/fde end`).

## FDE mode

`/fde on` puts the session in FDE mode: it creates `agent/fde-<timestamp>` as a
global branch on the selected ontology and binds the session, subagents
included, to it. `/fde <goal>` does the same with a goal, which names the branch
(`agent/fde-<goal>-<timestamp>`) and heads the prompt and the handoff;
`/fde goal <text>` sets or changes it later. `/fde --branch <rid> [goal]` adopts
an open global branch on the selected ontology instead, whoever made it (a
Foundry AI FDE branch is `ai-fde/<user>/<slug>`). The agent still creates only
`agent/` branches, and a branch not named `agent/` is adopted only when you type
the command yourself (the terminal or Remote Control; not a `-p` run or the
Agent SDK), not when a peer session, a relay, a channel, a trigger or another
plugin sends it. `/fde end` needs you to type it the same way, and so does
`/fde resume` of a branch not named `agent/`. Such a branch is flagged in the
status, the prompt (others may have work on it) and the handoff, which leaves
closing it to its owner; a name that is not a plain branch name shows as its
RID, and an open proposal on it is named when it is adopted. While bound:

- The mode refuses exactly one thing itself: a write aimed directly at main or
  master, however it is spelled (`--branch main`, `-bmaster`, `HEAD`,
  `refs/heads/main`, quoted or joined to the flag). Everything else on
  branches is the agent's to do — creating, closing, deploying or renaming
  global branches, raising, reviewing, accepting and merging proposals, and
  applying writes — each judged by the branch rule and the approval ladder
  exactly as they do without the mode (in `yolo` that means no asks outside a
  write on main; in the other modes the ladder's and the manifest's questions
  stand).
- Ontology writes that name no branch get the session's branch added. A call
  that names another global branch, another ontology, or no branch at all is
  judged by the base rules, not by the mode; `--profile` on a write is refused
  by the ladder as always.
- With a namespace in scope (`/namespace`), `/fde on` and `/fde --branch` still
  check first that the ontology is in it, and refuse before any branch exists
  if it is not, if it is in no namespace, or if the check cannot run. The
  namespace stays in scope while bound — `/namespace` and the pane's clear
  button leave it as it is until `/fde end`, and `/scope clear` keeps it on
  the stack the session is bound to — but writes are not held to it. A space
  name or path that is not plain shows as its RID.
- The goal, branch and namespace go into the system prompt and a band above
  the prompt, and every turn is traced (not only the ones that touch Foundry).

`/fde end` prints a handoff (branch, namespace, the writes the session ran,
how to merge or close it) and leaves the branch open. If a
session ends while bound, the next one offers `/fde resume`. The branch rule
and the approval ladder (with its destructive rule, outside `yolo`) judge every
bound call as they do without the mode. It changes context in one place: the
link types and interfaces picked while a binding was in scope go with it, when
`/fde end` ends it or another binding replaces it.

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

Only you can turn on `yolo`: `/approval yolo` from the terminal or Remote
Control works; from an SDK turn (`claude -p`), a peer, a relay, a channel or a
trigger it is refused and the mode stays as it was. Those origins can still pick
a stricter mode. `/approval rules` shows what the guard reads. The rules steer the guard only:
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
node scripts/orthanc-tie.mjs check
```

`orthanc-tie.mjs check` fails when plugin.json, marketplace.json,
`hooks/orthanc-tie.ts` and the manifest snapshot disagree (a hooks module cannot
read plugin.json, so `orthanc-tie.ts` mirrors it), and when an agent, skill,
slash command or this README names an `orthanc …` command that the pinned
manifest does not have. `validate` warns that
`min_orthanc` and `orthanc_checked` are unknown fields; Claude Code ignores them.

`hooks/*.test.ts` cover the ladder, parity, the context view and trace export. For an E2E run
against your own stack, record real Orthanc output and replay it:

```
FOUNDRY_E2E_PROFILE=<profile> FOUNDRY_E2E_PROJECT=<project rid> \
FOUNDRY_E2E_ONTOLOGY=<ontology rid> FOUNDRY_E2E_SPACE=<namespace rid> \
FOUNDRY_E2E_BRANCH=<open global branch rid on that ontology> ./scripts/record.sh
```

`FOUNDRY_E2E_SPACE` is required; `FOUNDRY_E2E_BRANCH` is optional and records the
branch-qualified link-type and interface reads FDE mode sends.

That writes `hooks/fixtures.local.ts`, which `hooks/e2e.local.test.ts` replays.
Both stay out of git: they hold your stack's data.

## License

MIT
