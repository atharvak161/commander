# commander

**Pick flags from buttons. Get a command you can paste. Read it back with every
piece explained.**

A static, client-side reference and command builder for tools that run in a
terminal — offensive, defensive, and plain system administration.

Live at <https://atharvaxsecurity.com/commander/> *(not yet deployed)*

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

Phase 1a, in progress. Three tools: nmap, gobuster, ffuf.

| Piece | State |
|---|---|
| Schema | done — `data/SCHEMA.md` |
| Checker | done — `tools/check.mjs` |
| Verifier | done — `tools/verify.mjs` |
| ffuf data | done — 77 flags, verified against the binary |
| nmap, gobuster | not started |
| Interface | not started |

## How the data is trusted

Every flag is read from a real binary's `man` or `--help` output, never from a
blog or from memory, and records which. `tools/verify.mjs` then runs the actual
tool with every flag to confirm it is accepted — no packets are sent, because a
tool rejects an unknown flag long before it opens a socket.

```
node tools/check.mjs          # schema, references, symmetry, freshness
node tools/verify.mjs ffuf    # every flag, against the real binary
```

`check.mjs` runs on pre-commit. A tool only appears in the interface once its
data passes both.

## Ethics

This generates text. It is for learning, for authorised testing, and for the
command you half-remember at 2am. Running a generated command against a system
you do not own or have written permission to test is your responsibility and
likely a criminal offence. Do not do it.

## Licence

TBD.
