/** nikto recipes. The target is passed with -host; -Tuning narrows the tests. */
export const examples = {
  target: 'https://target.example.com',
};

export const recipes = [
  {
    id: 'default',
    name: 'Standard scan',
    category: 'Baseline',
    summary: 'Point it at a host and run everything. The sensible first pass.',
    flags: { host: true },
    when: 'Any web server you are allowed to test, when you want full coverage.',
    cost: 'Minutes to tens of minutes. Noisy — it is not meant to be quiet.',
  },
  {
    id: 'ssl',
    name: 'HTTPS on a non-standard port',
    category: 'Baseline',
    summary: 'Force SSL and set the port, for a service not on 443.',
    flags: { host: true, ssl: true, port: '8443' },
    when: 'The target speaks HTTPS on a port nikto would not assume.',
    cost: 'Same as a standard scan.',
  },
  {
    id: 'tuned',
    name: 'Only the interesting tests',
    category: 'Focused',
    summary: 'Tuning 1234b: interesting files, misconfig, info disclosure, injection, software id. Skips DoS.',
    flags: { host: true, Tuning: '1234b' },
    when: 'You want signal without the slow or dangerous categories.',
    cost: 'Faster than a full scan.',
  },
  {
    id: 'injection',
    name: 'Injection and command execution only',
    category: 'Focused',
    summary: 'Tuning 489c: injection, SQL injection, command execution, remote source inclusion.',
    flags: { host: true, Tuning: '489c' },
    when: 'You are chasing injection specifically and want nikto focused on it.',
    cost: 'Quick.',
  },
  {
    id: 'evasive',
    name: 'With IDS evasion',
    category: 'Evasion',
    summary: 'Evasion technique 1 (random URI encoding) to slip past a simple filter.',
    flags: { host: true, evasion: '1' },
    when: 'A WAF or IDS is dropping the plain requests.',
    cost: 'Same, with a higher chance of odd results.',
  },
  {
    id: 'authed',
    name: 'Authenticated scan',
    category: 'Coverage',
    summary: 'Supply HTTP basic credentials so it reaches pages behind auth.',
    flags: { host: true, id: 'user:pass' },
    when: 'The interesting surface is behind a basic-auth prompt.',
    cost: 'Same as a standard scan.',
  },
  {
    id: 'report-json',
    name: 'Save a JSON report',
    category: 'Output',
    summary: 'Write findings to a file as JSON, for the report or further processing.',
    flags: { host: true, Format: 'json', output: 'nikto.json' },
    when: 'You want the output structured rather than scrolling past.',
    cost: 'Same as a standard scan.',
  },
  {
    id: 'vhost',
    name: 'Scan a virtual host',
    category: 'Coverage',
    summary: 'Set the Host header so a name-based virtual host is reached, not the default site.',
    flags: { host: true, vhost: 'app.target.example.com' },
    when: 'One IP serves several sites by Host header.',
    cost: 'Same as a standard scan.',
  },
  {
    id: 'proxied',
    name: 'Through a proxy',
    category: 'Coverage',
    summary: 'Route every request through an intercepting proxy so you can watch and replay.',
    flags: { host: true, useproxy: 'http://127.0.0.1:8080' },
    when: 'You want the traffic in Burp or ZAP.',
    cost: 'Same, limited by the proxy.',
  },
  {
    id: 'timeboxed',
    name: 'Time-limited scan',
    category: 'Focused',
    summary: 'Cap the time per host, for when the window is tight or the target is slow.',
    flags: { host: true, maxtime: '10m' },
    when: 'A scan budget, or a host that must not be hit for long.',
    cost: 'Whatever you set.',
  },
];

/** Swap suggestions for the breakdown. */
export const alternatives = {
  Tuning: [
    { id: 'Plugins', when: 'you want to name the exact plugins rather than tune categories' },
  ],
  Format: [
    { id: 'Save', when: 'you want the raw positive responses saved, not a formatted report' },
  ],
  evasion: [
    { id: 'useragent', when: 'the block is on the User-Agent rather than the request shape' },
  ],
};
