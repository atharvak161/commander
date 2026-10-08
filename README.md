# commander

**Pick flags from buttons. Get a command you can paste. Read it back with every
piece explained.**

A static, client-side reference and command builder for tools that run in a
terminal — offensive, defensive, and plain system administration.

Live at <https://atharvaxsecurity.com/commander/>

## What it does

Choose a tool, read its manual, pick flags from buttons that explain themselves
on hover, fill in your target and wordlist once, and watch the command assemble.
Then read the finished command back, broken into pieces, each labelled with what
it does — so you leave understanding it rather than only holding it.

## What it does not do

**It never executes anything.** It is a static page: no backend, no API, no
accounts. Nothing you type leaves your browser. You copy a command and run it
yourself, against a target you are authorised to test. That boundary is the
security model.

## Status

Phase 1a. **ffuf, nmap and sqlmap are live and complete.** gobuster is next.

| Piece | State |
|---|---|
| Schema | done — `data/SCHEMA.md` |
| Checker | done — `tools/check.mjs` |
| Verifier | done — `tools/verify.mjs`, three passes |
| Quoting round-trip | done — `test/quoting.mjs` |
| Enum proof | done — `test/enums.mjs` |
| Placeholder guard | done — `test/placeholders.mjs` |
| ffuf | done — 77 flags, 4 enums, 5 repeatables, verified |
| nmap | done — 133 flags from help+man, every one put to the binary |
| sqlmap | done — 271 flags read from sqlmap's own option objects |
| Interface | done — picker, slots, command bar, explainer |
| gobuster | not started |

## How the data is trusted

Every flag is read from a real binary's `man` or `--help` output, never from a
blog or from memory, and records which. Relationships between flags are parsed
from the tool's own sentences — "Implies -ac", "Overrides -w" — rather than
assumed, so they stay correct when the tool changes. Nothing is invented: a
relationship the tool does not state is left empty.

Then it is proved against the binary, four ways:

```
node tools/check.mjs          # schema, references, conflict symmetry, freshness, repo hygiene
node tools/verify.mjs ffuf    # every flag and every valid pair, against the real binary
node tools/verify.mjs ffuf --pairs
node test/quoting.mjs         # the copied text, parsed by a real shell
node test/enums.mjs           # every enum value, and that the set is really closed
node test/placeholders.mjs    # no flag can swallow the one after it
node tools/probe-nmap.mjs    # nmap only: ask the binary which candidates are real
python3 tools/dump-sqlmap-options.py <libexec>   # sqlmap only: its own option objects
```

**`verify.mjs`** runs the actual tool. Singles, awkward values (spaces, quotes,
`$`, backslashes, semicolons), and every valid pair — 2,992 real commands for
ffuf, all accepted. No packets are sent: a tool rejects an unknown flag long
before it opens a socket.

**`test/quoting.mjs`** closes the gap that matters most. The verifier runs an
argument *array*; you copy a *string* a shell parses. If the quoting were wrong
those two would differ and the verified command would not be the one that runs.
So it hands the text to `/bin/sh` and asserts the arguments come back
byte-identical — 1,535 cases, including `a;rm -rf /` staying a single harmless
argument.

**`test/enums.mjs`** asks the binary whether a closed value set is really
closed: every declared value must be accepted, and a value outside the list must
be rejected. This is what caught that ffuf ignores `-of` entirely unless `-o` is
also set.

**`test/placeholders.mjs`** covers the case where you have picked a flag but
not filled its value. A bare token built `ffuf -u -w /list`, where ffuf reads
`-w` as the *value* of `-u`: assembled-looking, wrong, and failing in a way that
does not point at the cause. A flag awaiting a value now shows a quoted
placeholder, Copy is disabled until the gap is filled, and the test asserts no
flag can ever swallow the one after it.

**nmap needed a different kind of proof.** Its `-h` is a summary — it documents
98 flags where the man page documents 160 — and the man page's prose mentions
`-oG-` and `-d9` as examples of usage, which are not options. So both are read,
and then every candidate is put to nmap itself: `tools/probe-nmap.mjs` keeps only
what nmap accepts, and uses nmap's own "requires an argument" to correct whether
a flag takes a value. The text proposes, the binary decides.

That probe is safe because of two things nmap does. It parses every argument
*before* it checks privilege, so "requires root privileges" is proof a flag
parsed rather than a failure; and with no target it scans nothing. So the whole
flag set is verified with no root and **no packets** — the verifier strips the
`<Target>` placeholder before running, which is exactly what leaves the command
targetless.

**sqlmap needed a third kind of source.** Its `-hh` truncates long option names
to a fixed column — `--openapi=OPENAP..`, `-A AGENT, --user..`, 59 of them — and
it ignores `COLUMNS`, so no terminal width recovers them. Parsing that would
invent flags. But sqlmap is Python and declares its options with optparse, so
`tools/dump-sqlmap-options.py` hooks `add_option` and lets sqlmap build its own
parser, then reads the real objects: full names, types, actions, defaults and
group titles, in sqlmap's own order. That is the declaration the help is a lossy
rendering of.

The same source settles its enums. sqlmap validates exactly two options against
a fixed set, and both are enum classes that can be read directly — which matters,
because the help text for `--tor-type` lists three values and omits `HTTPS`,
which the binary accepts. Everything else that looks like a set in sqlmap's help
is an `e.g.` example, and `-v`'s documented `0-6` is advisory: it accepts
anything. `test/enums.mjs` is what establishes the difference, by asking the
binary.

The browser and the verifier import the **same** `assets/js/command.js`, so a
verified command is byte-for-byte the one the page gives you. `check.mjs` runs on
pre-commit. A tool only appears in the interface once its data passes all of it.

## Ethics

This generates text. It is for learning, for authorised testing, and for the
command you half-remember at 2am. Running a generated command against a system
you do not own or have written permission to test is your responsibility and
likely a criminal offence. Do not do it.

## Licence

TBD.
