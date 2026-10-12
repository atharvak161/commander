/** nuclei recipes. The target is -u; -t or -tags choose the templates. */
export const examples = {
  target: 'https://target.example.com',
};

export const recipes = [
  {
    id: 'default',
    name: 'Scan with all templates',
    category: 'Baseline',
    summary: 'Run the full template set against one target. Thorough, and the usual first pass.',
    flags: { target: true },
    when: 'Any target you are allowed to test, when you want everything checked.',
    cost: 'Minutes. Thousands of templates.',
  },
  {
    id: 'cves',
    name: 'Known CVEs only',
    category: 'Focused',
    summary: 'Run just the CVE templates, the quickest route to a known-vulnerable version.',
    flags: { target: true, tags: 'cve' },
    when: 'You want known vulnerabilities, not misconfigurations and info.',
    cost: 'Faster than a full run.',
  },
  {
    id: 'high',
    name: 'High and critical severity',
    category: 'Focused',
    summary: 'Only templates rated high or critical, to cut straight to what matters.',
    flags: { target: true, severity: 'high,critical' },
    when: 'A first triage pass, or a target you can only hit briefly.',
    cost: 'Quick.',
  },
  {
    id: 'tech',
    name: 'Technology detection',
    category: 'Recon',
    summary: 'Run the technology-detection templates to fingerprint what the target runs.',
    flags: { target: true, 'template-id': 'tech-detect' },
    when: 'Early recon, before deciding which deeper templates to run.',
    cost: 'Fast.',
  },
  {
    id: 'list',
    name: 'Scan a list of hosts',
    category: 'Scale',
    summary: 'Read targets from a file, cap the rate, and run across many hosts.',
    flags: { list: 'targets.txt', 'rate-limit': '150' },
    when: 'You have many hosts and want to sweep them politely.',
    cost: 'Scales with the list and the rate limit.',
  },
  {
    id: 'json',
    name: 'Save JSONL output',
    category: 'Output',
    summary: 'Write findings as JSON lines, the format most downstream tools expect.',
    flags: { target: true, 'jsonl-export': 'nuclei.jsonl' },
    when: 'You want the output structured for a pipeline or report.',
    cost: 'Same as the scan it runs.',
  },
  {
    id: 'proxy',
    name: 'Through a proxy',
    category: 'Coverage',
    summary: 'Route requests through an intercepting proxy so you can watch and replay them.',
    flags: { target: true, proxy: 'http://127.0.0.1:8080' },
    when: 'You want the traffic in Burp or ZAP.',
    cost: 'Limited by the proxy.',
  },
  {
    id: 'quiet',
    name: 'Rate-limited and quiet',
    category: 'Evasion',
    summary: 'Cap requests per second and concurrency, for a target with monitoring.',
    flags: { target: true, 'rate-limit': '50', concurrency: '10' },
    when: 'You would rather not trip rate alarms.',
    cost: 'Slower by design.',
  },
];

export const alternatives = {
  tags: [
    { id: 'template-id', when: 'you want to name exact templates rather than a category tag' },
  ],
  'rate-limit': [
    { id: 'concurrency', when: 'the constraint is parallel templates rather than requests per second' },
  ],
  'jsonl-export': [
    { id: 'output', when: 'you want the plain-text findings rather than JSON lines' },
  ],
};
