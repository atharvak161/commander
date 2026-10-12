/** whatweb recipes. The target is a trailing argument; -a sets aggression. */
export const examples = {
  target: 'https://target.example.com',
};

export const recipes = [
  {
    id: 'default',
    name: 'Quick fingerprint',
    category: 'Baseline',
    summary: 'One request per target, follows redirects. The default, and the quiet first look.',
    flags: {},
    when: 'Any web target. The fastest way to learn what it runs.',
    cost: 'One request per target. Seconds.',
  },
  {
    id: 'verbose',
    name: 'Verbose fingerprint',
    category: 'Baseline',
    summary: 'The same scan with plugin descriptions, so you see why each match was made.',
    flags: { verbose: true },
    when: 'You want the reasoning, not just the list of technologies.',
    cost: 'Same requests, more output.',
  },
  {
    id: 'aggressive',
    name: 'Aggressive scan',
    category: 'Depth',
    summary: 'Aggression 3: when a stealthy plugin matches, make the extra requests to pin the version.',
    flags: { aggression: '3' },
    when: 'You need exact versions and the target can take a few more requests.',
    cost: 'More requests per target.',
  },
  {
    id: 'heavy',
    name: 'Heavy scan',
    category: 'Depth',
    summary: 'Aggression 4: every plugin tries its URLs. The most thorough and the loudest.',
    flags: { aggression: '4' },
    when: 'A single high-value target where coverage matters more than noise.',
    cost: 'Many requests per target.',
    warn: 'Heavy mode is noisy and hits many paths. Scope it; do not point it at a whole range.',
  },
  {
    id: 'range',
    name: 'Scan a network range',
    category: 'Discovery',
    summary: 'Fingerprint every host in a CIDR range, suppressing the errors from dead hosts.',
    flags: { 'no-errors': true },
    when: 'You have a range and want to know what web servers are on it.',
    cost: 'One request per live host.',
  },
  {
    id: 'proxied',
    name: 'Through a proxy',
    category: 'Coverage',
    summary: 'Route requests through an intercepting proxy so you can watch and replay them.',
    flags: { proxy: '127.0.0.1:8080' },
    when: 'You want the traffic in Burp or ZAP.',
    cost: 'Limited by the proxy.',
  },
  {
    id: 'report-json',
    name: 'Log to JSON',
    category: 'Output',
    summary: 'Write the findings to a JSON file for the report or further processing.',
    flags: { 'log-json': 'whatweb.json' },
    when: 'You want the output structured.',
    cost: 'Same as the scan it runs.',
  },
  {
    id: 'grep',
    name: 'Match one technology',
    category: 'Focused',
    summary: 'Show only targets where a string or regex matches, for sweeping a range for one thing.',
    flags: { grep: 'WordPress' },
    when: 'You are hunting a specific technology across many hosts.',
    cost: 'Same scan, filtered output.',
  },
];

export const alternatives = {
  aggression: [
    { id: 'plugins', when: 'you want to choose the exact plugins rather than a blanket level' },
  ],
  'log-json': [
    { id: 'log-xml', when: 'the downstream tool wants XML' },
    { id: 'log-brief', when: 'you only want a one-line summary per target' },
  ],
  proxy: [
    { id: 'user-agent', when: 'you only need to change how you identify, not route the traffic' },
  ],
};
