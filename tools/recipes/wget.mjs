/** wget recipes. The URL is a trailing argument. */
export const examples = {
  target: 'https://target.example.com/file',
};

export const recipes = [
  {
    id: 'download',
    name: 'Download a file',
    category: 'Basic',
    summary: 'The plain fetch. Saves the file under its own name in the current directory.',
    flags: {},
    when: 'You just want the file.',
    cost: 'As long as the transfer takes.',
  },
  {
    id: 'quiet-out',
    name: 'Download quietly to a name',
    category: 'Basic',
    summary: 'No progress output, written to a filename you choose. Good for scripts and shells.',
    flags: { quiet: true, 'output-document': 'out.bin' },
    when: 'You are pulling a file onto a target through a shell and want it named.',
    cost: 'As long as the transfer takes.',
  },
  {
    id: 'resume',
    name: 'Resume a broken download',
    category: 'Basic',
    summary: 'Continue a partial file instead of starting over.',
    flags: { 'continue': true },
    when: 'A large download dropped partway.',
    cost: 'The remainder of the transfer.',
  },
  {
    id: 'mirror',
    name: 'Mirror a site',
    category: 'Recursive',
    summary: 'Recursively download a whole site, following links, converting them for offline viewing.',
    flags: { mirror: true, 'convert-links': true, 'page-requisites': true, 'no-parent': true },
    when: 'You want a local copy of a site to read or grep offline.',
    cost: 'Potentially large — it follows every link under the path.',
    warn: 'Mirroring hits many URLs. Scope it with --no-parent and a sensible --level.',
  },
  {
    id: 'spider',
    name: 'Check a link without downloading',
    category: 'Recon',
    summary: 'Act as a spider: check that a URL exists, pull headers, but do not save anything.',
    flags: { spider: true, 'server-response': true },
    when: 'You want to confirm a path or read its headers without fetching the body.',
    cost: 'One request.',
  },
  {
    id: 'no-tls-check',
    name: 'Ignore a certificate error',
    category: 'Control',
    summary: 'Download over HTTPS even when the certificate does not validate.',
    flags: { 'no-check-certificate': true },
    when: 'A self-signed or expired certificate blocks a download you still want.',
    cost: 'Same as the download.',
    warn: 'Disabling the certificate check removes the integrity guarantee. Only when you accept that.',
  },
  {
    id: 'auth',
    name: 'Download with HTTP auth',
    category: 'Control',
    summary: 'Supply a username and password for a basic-auth protected file.',
    flags: { 'user': 'user', 'password': 'pass' },
    when: 'The file is behind HTTP basic authentication.',
    cost: 'Same as the download.',
  },
  {
    id: 'ua',
    name: 'Set a user-agent and headers',
    category: 'Control',
    summary: 'Identify as a chosen user-agent and add a header, for a server that filters on them.',
    flags: { 'user-agent': 'Mozilla/5.0', header: 'X-Forwarded-For: 127.0.0.1' },
    when: 'The server rejects the default wget user-agent.',
    cost: 'Same as the download.',
  },
];

export const alternatives = {
  'output-document': [
    { id: 'output-file', when: 'you mean the log file, not the downloaded file' },
  ],
  mirror: [
    { id: 'recursive', when: 'you want recursion without the mirror-mode defaults (timestamps, infinite depth)' },
  ],
  'user-agent': [
    { id: 'header', when: 'you need to set an arbitrary header rather than just the agent' },
  ],
};
