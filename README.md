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

**ffuf, nmap, sqlmap, gobuster, curl and tshark are live**, 881 flags and 78 ready-made commands.

| Piece | State |
|---|---|
| Schema | done — `data/SCHEMA.md` |
| Checker | done — `tools/check.mjs` |
| Verifier | done — `tools/verify.mjs`, parallel, every mode |
| Quoting round-trip | done — `test/quoting.mjs` |
| Enum proof | done — `test/enums.mjs` |
| Placeholder guard | done — `test/placeholders.mjs` |
| Relationships | done — `test/relationships.mjs` |
| Repeatable flags | done — `test/repeatable.mjs` |
| Coverage gate | done — `tools/coverage.mjs` |
| ffuf | done — 78 flags, 6 enums, 5 repeatables |
| nmap | done — 140 flags from help+man, every one put to the binary |
| sqlmap | done — 271 flags read from sqlmap's own option objects |
| gobuster | done — 59 flags across 7 modes, with per-mode overrides |
| curl | done — 257 flags, 27 repeatable, read from help + man |
| tshark | done — 76 flags, probed without ever opening an interface |
| Interface | done — picker, slots, command bar, explainer |

## How the data is trusted

Every flag is read from a real binary's `man` or `--help` output, never from a
blog or from memory, and records which. Relationships between flags are parsed
from the tool's own sentences — "Implies -ac", "Overrides -w" — rather than
assumed, so they stay correct when the tool changes. Nothing is invented: a
relationship the tool does not state is left empty.

Then it is proved against the binary:

```
node tools/coverage.mjs       # did we MISS a flag? see below
node tools/check.mjs          # schema, references, conflict symmetry, freshness, repo hygiene
node tools/verify.mjs ffuf    # every flag and every valid pair, against the real binary
node tools/verify.mjs ffuf --pairs
node test/quoting.mjs         # the copied text, parsed by a real shell
node test/enums.mjs           # every enum value, and that the set is really closed
node test/placeholders.mjs    # no flag can swallow the one after it
node test/relationships.mjs   # conflicts block both ways and nothing else does
node test/repeatable.mjs      # a flag you may give twice is emitted twice
node tools/probe.mjs <tool>   # drop what the binary refuses, whatever the help says
node tools/probe-nmap.mjs    # nmap only: it needs more than membership
python3 tools/dump-sqlmap-options.py <libexec>   # sqlmap only: its own option objects
```

**`verify.mjs`** runs the actual tool, in parallel, once per mode. Singles,
awkward values (spaces, quotes, `$`, backslashes, semicolons), and every valid
pair — 3,134 commands for ffuf, 9,803 for nmap, 3,714 for gobuster, 8,419 for
sqlmap, all accepted. A tool rejects an unknown flag long before it opens a
socket, which is why this is safe; the flags that would break that rule are
refused outright, see below.

**`test/quoting.mjs`** closes the gap that matters most. The verifier runs an
argument *array*; you copy a *string* a shell parses. If the quoting were wrong
those two would differ and the verified command would not be the one that runs.
So it hands the text to `/bin/sh` and asserts the arguments come back
byte-identical — 10,219 cases across the four tools, including `a;rm -rf /`
staying a single harmless argument.

**`test/relationships.mjs`** checks the half that is easy to forget. Every
declared conflict must block in both directions — and **nothing else may
block**. A blocker that is too eager silently removes valid commands and gives
the user no way to find out why. It also covers "at least one of these": ffuf
takes `-request` in place of `-u` and `--input-cmd` in place of `-w`, so
demanding `-u` outright argued with a command that works.

**`test/repeatable.mjs`** covers the flags you are allowed to give more than
once. `-H` and `--headers` are the everyday case — two or three headers in one
command is ordinary — and the interface offered a single box, so the second and
third were silently dropped.

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

**gobuster is the first tool with real modes.** `dir`, `vhost`, `dns`, `fuzz`,
`tftp`, `s3` and `gcs` are subcommands with their own option sets. Most options
are shared, but four genuinely differ: `--timeout` defaults to 10s over HTTP and
1s for DNS and TFTP, and `--domain` is the target in `dns` while in `dir` it is
"the domain to append when using an IP address as URL". One entry per mode-flag
pair would duplicate the 56 shared options seven times; one shared entry would
hide the difference. So a flag carries a `perMode` override of only the fields
that differ, and everything reads it through `resolveFlag`.

### A probe that never finished is not a pass

The verifier runs the real tool and looks for a rejection in its output. That
is only sound if the tool actually ran. sqlmap reads its target list from
**stdin** when no target option is given, so with an open pipe it waits
forever — 213 of its 271 flags sat until the timeout. A timed-out probe matches
no rejection pattern, so every one of them was counted as **accepted**: a
silent pass for a command that never executed.

Two changes. Probes run through `spawn` with stdin on `'ignore'`, which hands
the tool an immediate EOF and takes the same probe from 12 seconds to 0.4.
(`execFile` cannot do this — it overrides `stdio` so it can capture output.)
And a timeout is now reported as INCONCLUSIVE and fails the run, because the
one thing a verifier must never do is report success for work it did not do.

What remains are two of sqlmap's own test runners, `--fp-test` and
`--payload-lint`, which genuinely take minutes. They are in the documented skip
list rather than quietly timing out.

### Nothing the verifier runs may leave the machine

That is the premise of the whole approach — a tool rejects an unknown flag long
before it opens a socket — so it has to be enforced rather than assumed. It was
not. An exhaustive pair run surfaced 201 probes stalling on sqlmap's `-g`, which
is a **Google dork**: the verifier had been querying a search engine, once per
pair, for an hour. `--check-internet` fetches `google.com/generate_204`, named
in sqlmap's own `settings.py`.

Worse was waiting in nmap. **`-iR <num>` does not mean "pretend": nmap
generates random PUBLIC IP addresses and scans them.** Running it here was
scanning strangers' machines from this laptop, once per probe. `-iL` reads
targets from a file and resolves every line; `--dns-servers` points nmap at a
resolver and waits on it.

There is now an explicit `NETWORK` set — `-g`, `--gpage`, `--check-internet`,
`--tor`, `--update`, `--dependencies`, `-iR`, `-iL`, `--dns-servers` — that the
verifier refuses to run.
Membership for those flags is established by the declaration and the singles
pass, neither of which needs them to actually execute. Where a target is
unavoidable it is loopback port 1 (refused instantly, never leaves the host) or
an RFC 2606 `.invalid` name that cannot resolve.

### A writer must not be handed a reader's file

Every path-typed flag used to get the same sample file. So `--output <that
file>` truncated the wordlist *as the run proceeded*, and every probe after it
saw an empty wordlist — which makes gobuster's `fuzz` mode hang. 859 pairs
reported as stalled, and the cause was three pairs earlier in the sequence;
every one of them passed in isolation, which is what made it hard to see.

Output-ish flags now get their own file, one per probe, and the shared sample
is `chmod 444` so the mistake fails loudly instead of corrupting the run.
gobuster went from 859 stalls to none, and from a timeout-bound crawl to 64
seconds.

## Did we miss a flag?

`tools/coverage.mjs` is the gate for that, and it works the opposite way round
from the extractors. It sweeps every flag-shaped token out of every document a
tool has, subtracts what we carry, and puts each leftover to the **binary**.
It also probes all 62 single-character flags outright, because sweeping
documents can only find what the documents mention — that is how `-4` turned up,
which nmap accepts and documents in neither its help nor its man page.

It knows the ways a token can look like a new flag without being one: an
attached value (`-p22` is `-p` with `22`), getopt bundling (`-r4d` is `-r -4 -d`,
and comes from ASCII art in nmap's man page), an unambiguous abbreviation
(optparse resolves `--user` to `--user-agent`, and sqlmap's help literally
prints the truncated `--hea`), and Go's indifference to dash count (`--input-num`
is ffuf's `-input-num`). Anything genuinely accepted but deliberately not
offered — easter eggs, removed options, incomplete prefixes — is listed in
`REVIEWED` with the reason and the tool's own words. An unreviewed token fails
the build.

It found `-recursion-strategy`, a real ffuf flag with a closed value set that
was missing entirely because its name is long enough to eat the column padding
in ffuf's help, leaving one space where the parser wanted two.

The browser and the verifier import the **same** `assets/js/command.js`, so a
verified command is byte-for-byte the one the page gives you. `check.mjs` runs on
pre-commit. A tool only appears in the interface once its data passes all of it.

**curl's help lists an option this build refuses.** `--socks5-gssapi-service`
appears in `curl --help all` and then answers "option
--socks5-gssapi-service: is unknown", because the name is compiled in but the
library behind it is not. `tools/probe.mjs` is the generic form of the nmap
probe: it puts every extracted flag to the binary and drops what is refused.

Finding that needed a fix to the verifier first. Its rejection patterns did not
include curl's wording — curl writes "option --x: is unknown", not "unknown
option" — so **curl's verification could not fail**. Two narrower bugs came out
of the same fix: a rejection must now name the flag (curl's `--manual` prints a
manual containing the words "Unknown option specified to libcurl", which was
being read as an error), and it is matched with its dashes (Go echoes `--bogus`
back as `-bogus`, and matching the bare name made "you passed a" look like a
rejection of `--pass`).

## Ready-made commands

Every tool has a **Ready-made** tab: complete, working commands for the jobs
people actually do, grouped by what you are trying to achieve — everyday,
stealth and evasion, enumeration, debugging. 65 of them so far
(curl 15, ffuf 11, gobuster 11, nmap 16, sqlmap 12).

They read as something you could run straight away, because they are: before
you have typed anything they show a complete command against `example.com`,
and the moment you fill in the panel on the right every command on the page
switches to your values. Each one is closed until you click it — the point is
to scan fifteen commands quickly — and opening it shows the same piece-by-piece
breakdown the builder gives, plus an **"or change it"** list: `-T4` is the
timing template, swap it for `-T2` to stay under rate-based detection, or `-T5`
on your own fast network.

A recipe is not a string. It names flags and values, and is built through the
same `buildCommand` as everything else, so it gets the same quoting, the same
ordering and the same conflict handling — and `tools/verify.mjs` runs every
recipe against the real binary like any other command. `check.mjs` refuses a
recipe that names a flag the tool does not have, gives a value to a flag that
takes none, or sets an enum to something outside its set. It caught two wrong
flag ids in these the first time they were written.

Recipes are **built without their examples** when verified. A recipe's example
target is a real host — `scanme.nmap.org`, a `/24` — and running one as written
would scan it. With the examples withheld the target becomes a placeholder the
verifier strips, and the flags are still proved with nothing to aim at.

### tshark is the one that bites

Every other tool here, given no target, prints its help and exits — which is
what makes probing safe. **tshark given no arguments starts capturing live
traffic off the default interface.** The assumption the whole approach rests on
is false for exactly one tool, and it is not obvious until you run it.

The safe mode is `-r <file>`: reading a capture never touches the network. So
every tshark probe is prefixed with `-r` and a 24-byte empty pcap, and the
flags are parsed and rejected exactly as normal with nothing captured.

That rule first lived in `verify.mjs` alone — and `probe.mjs`, which has its
own runner, therefore ran bare `tshark` commands that opened an interface.
Nothing was captured, but it was luck rather than design. The rules now live in
`tools/probe-safety.mjs` and all three probing tools import them, so they
cannot drift apart again. Proved by watching the process table through a full
run: no `tshark` without `-r`.

## Rebuilding the data

One extractor per tool, never a universal parser — four tools print four
incompatible shapes, and a parser general enough for all of them is a parser
that quietly mis-reads each. Each writes `data/tools/<id>.json`; nothing in
that directory is edited by hand.

```
nmap -h > data/manuals/nmap.help.txt && man nmap | col -bx > data/manuals/nmap.txt
sqlmap -hh > data/manuals/sqlmap.txt
python3 tools/dump-sqlmap-options.py <sqlmap libexec> > data/manuals/sqlmap.options.json

node tools/extract-ffuf.mjs
node tools/extract-nmap.mjs && node tools/probe-nmap.mjs   # the probe corrects the data
node tools/extract-sqlmap.mjs
node tools/extract-gobuster.mjs                            # runs gobuster <mode> --help itself
node tools/build-manifest.mjs
```

Then the gates above. A tool only reaches the interface once it passes all of
them.

## Ethics

This generates text. It is for learning, for authorised testing, and for the
command you half-remember at 2am. Running a generated command against a system
you do not own or have written permission to test is your responsibility and
likely a criminal offence. Do not do it.

## Licence

TBD.
