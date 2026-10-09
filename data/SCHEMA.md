# Tool data schema

One JSON file per tool in `data/tools/<id>.json`. Everything the site renders —
the flag picker, the manual, the command bar, the explainer — reads this and
only this. There is no second copy of any fact.

## Why it looks like this

Designed against the three hardest real cases found before any code was written:

- **gobuster** has 7 modes with different flag sets → `modes` exists from day one
- **nmap** documents 160 flags in `man` but only 91 in `-h` → `source` records which
- **ffuf** states in its own help that `-cc` requires `-ck` → `requires` is first-class

## Shape

```jsonc
{
  "id": "gobuster",                  // filename, URL slug, manifest key
  "name": "gobuster",                // display name
  "summary": "Directory, DNS and vhost brute-forcer.",
  "category": "recon",               // domain from the plan
  "homepage": "https://github.com/OJ/gobuster",
  "manual": "data/manuals/gobuster.txt",   // raw man/help, for the help tab
  "helpCommand": "gobuster dir --help",    // what the user runs to get it themselves

  "provenance": {
    "toolVersion": "3.8.2",
    "source": "help",                // "man" | "help" | "docs"
    "tier": "A",                     // A local, B container, C documentation
    "verifiedAt": "2026-10-08",
    "host": "darwin-arm64"
  },

  // A mode is a subcommand. Tools without subcommands get one mode: "default".
  "modes": [
    {
      "id": "dir",
      "name": "dir",
      "summary": "Directory and file enumeration.",
      "usage": "gobuster dir -u <url> -w <wordlist> [flags]",
      "flags": ["url", "wordlist", "threads"]   // flag ids valid in this mode
    }
  ],

  // Input slots this tool can consume. The side panel renders these.
  // A trailing input is a bare argument rather than a flag value: nmap takes
  // its target that way. It is always shown, because no flag binds it, and
  // `requiredUnless` lets another flag supply it instead (nmap's -iL reads
  // targets from a file, so a target on the line is not required then).
  "inputs": [
    { "id": "target",   "label": "Target URL",  "kind": "url",  "placeholder": "https://example.com" },
    { "id": "wordlist", "label": "Wordlist",    "kind": "path", "placeholder": "~/wordlists/SecLists/..." },
    { "id": "target", "label": "Target", "trailing": true, "required": true, "requiredUnless": ["iL", "iR"] }
  ],

  // "At least one of these." Some requirements are not per-flag: ffuf accepts
  // -request in place of -u, and sqlmap's Target group says "At least one of
  // these options has to be provided". Marking one member required would
  // complain at someone who correctly used another.
  "requiresOneOf": [
    { "ids": ["u", "request"], "label": "the target" }
  ],

  "flags": [
    {
      "id": "wordlist",              // stable, referenced by modes/conflicts/requires
      "short": "-w",
      "long": "--wordlist",
      "takes": "path",               // none|string|int|path|url|port|enum|host
      "enum": null,                  // values, when takes == "enum"
      "binds": "wordlist",           // which input slot fills it
      "required": true,              // within the modes that list it
      "repeatable": false,
      "default": null,
      "group": "target",             // picker grouping
      "desc": "Path to the wordlist.",          // one line, hover + explainer label
      "help": "Longer paragraph...",            // expanded explanation
      "warn": null,                  // "root"|"slow"|"noisy"|"destructive"|"deprecated"|null
      "note": null,                  // free prose caveat, shown in the tooltip
      "perMode": null,               // { "<modeId>": { desc?, default?, takes?, binds?, required? } }
                                     //   ONLY the fields a mode genuinely changes.
                                     //   gobuster's --timeout is 10s over HTTP and 1s for
                                     //   DNS; --domain is the target in dns and something
                                     //   else in dir. One entry per mode-and-flag would
                                     //   duplicate the 56 shared options seven times; one
                                     //   shared entry would hide the difference.
                                     //   Read every flag through resolveFlag(flag, modeId).
      "conflicts": [],               // flag ids
      "requires": [],                // flag ids
      "since": null,
      "source": "help"               // per-flag, because nmap mixes man and help
    }
  ],

  "recipes": [
    {
      "id": "dir-common",
      "name": "Common directories",
      "mode": "dir",
      "flags": { "wordlist": "$WORDLIST", "threads": "20" },
      "when": "First pass on any web target.",
      "cost": "~5000 requests."
    }
  ]
}
```

## Rules the checker enforces

1. `id` matches the filename.
2. Every flag id is unique within the tool.
3. Every id in `modes[].flags`, `conflicts` and `requires` resolves to a real flag.
4. No flag conflicts with itself; no flag requires itself.
5. Conflicts are symmetric — if A conflicts with B, B conflicts with A.
6. Every flag has `desc`, `takes`, `group` and `source`.
7. `binds` names a declared input slot.
8. `takes: "enum"` has a non-empty `enum`; anything else has `enum: null`.
9. `provenance.verifiedAt` is within the freshness window.
10. Every tool in the manifest has a file, and every file is in the manifest.
