#!/usr/bin/env python3
"""
Ask sqlmap for its own option objects.

sqlmap's `-hh` TRUNCATES long option names to fit a fixed column: "--openapi=
OPENAP..", "-A AGENT, --user..". 59 of them. Those names are unusable, and
sqlmap ignores COLUMNS, so no terminal width recovers them.

But sqlmap is Python, and it declares every option with optparse. So rather
than read a derived, lossy rendering, we hook add_option and let sqlmap build
its own parser — then read the real objects: full names, types, actions,
defaults, help strings and group titles, in sqlmap's own declared order.

Emits JSON on stdout. tools/extract-sqlmap.mjs shapes it into the schema.
"""
import json, os, sys

LIB = sys.argv[1] if len(sys.argv) > 1 else None
if not LIB or not os.path.isdir(LIB):
    sys.exit("usage: dump-sqlmap-options.py <sqlmap libexec dir>")
sys.path.insert(0, LIB)

captured = []
import optparse
_g, _p = optparse.OptionGroup.add_option, optparse.OptionParser.add_option

def wrap(orig, default_title):
    def f(self, *a, **kw):
        o = orig(self, *a, **kw)
        captured.append((getattr(self, 'title', default_title), o))
        return o
    return f

optparse.OptionGroup.add_option = wrap(_g, 'General')
optparse.OptionParser.add_option = wrap(_p, 'General')

# sqlmap writes a banner and reads the real stdout fd, so send it to devnull
# rather than a StringIO (which has no fileno and raises UnsupportedOperation).
sys.argv = ['sqlmap', '-hh']
devnull = open(os.devnull, 'w')
real_out, real_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = devnull, devnull
try:
    from lib.parse.cmdline import cmdLineParser
    try:
        cmdLineParser(['-hh'])
    except SystemExit:
        pass
finally:
    sys.stdout, sys.stderr = real_out, real_err

out = []
for title, o in captured:
    out.append({
        "group": title,
        "short": [s for s in o._short_opts],
        "long": [l for l in o._long_opts],
        "type": o.type,
        "action": o.action,
        "dest": o.dest,
        "metavar": o.metavar,
        "default": None if o.default is optparse.NO_DEFAULT else o.default,
        "help": o.help or "",
        "choices": list(o.choices) if getattr(o, 'choices', None) else None,
    })

# The only two options sqlmap actually validates against a fixed set. It says
# so itself in lib/core/option.py ("accepts one of following values"), and the
# sets are enum classes, so read them rather than the help text — the help for
# --tor-type lists three values and omits HTTPS, which the binary accepts.
enforced = {}
try:
    from lib.core.enums import PROXY_TYPE, DUMP_FORMAT
    from lib.core.common import getPublicTypeMembers
    enforced["--tor-type"] = [v for v in getPublicTypeMembers(PROXY_TYPE, True)]
    enforced["--dump-format"] = [v for v in getPublicTypeMembers(DUMP_FORMAT, True)]
except Exception as e:
    enforced["_error"] = str(e)

version = "unknown"
try:
    from lib.core.settings import VERSION_STRING
    version = VERSION_STRING.split('/')[-1].strip()
except Exception:
    pass

json.dump({"version": version, "options": out, "enforced": enforced}, sys.stdout, default=str)
