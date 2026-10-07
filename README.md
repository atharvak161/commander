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

Phase 1a. **ffuf is live and complete.** nmap and gobuster are next.

| Piece | State |
|---|---|
| Schema | done — `data/SCHEMA.md` |
| Checker | done — `tools/check.mjs` |
| Verifier | done — `tools/verify.mjs`, three passes |
| Quoting round-trip | done — `test/quoting.mjs` |
| Enum proof | done — `test/enums.mjs` |
| ffuf | done — 77 flags, 4 enums, 5 repeatables, verified |
| Interface | done — picker, slots, command bar, explainer |
| nmap, gobuster | not started |

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
