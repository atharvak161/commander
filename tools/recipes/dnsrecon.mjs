/** dnsrecon recipes. The target is -d a domain; -t chooses the enumeration. */
export const examples = {
  target: 'target.example.com',
};

export const recipes = [
  {
    id: 'std',
    name: 'Standard enumeration',
    category: 'Baseline',
    summary: 'SOA, NS, A, AAAA, MX and SRV records. The sensible first look at a domain.',
    flags: { domain: true, type: 'std' },
    when: 'Any domain you are assessing. Start here.',
    cost: 'A handful of DNS queries. Seconds.',
  },
  {
    id: 'axfr',
    name: 'Zone transfer test',
    category: 'High value',
    summary: 'Ask every name server for a full zone transfer. A success hands you the entire zone.',
    flags: { domain: true, type: 'axfr' },
    when: 'Always worth trying — a misconfigured NS is a complete win.',
    cost: 'One query per name server.',
  },
  {
    id: 'brute',
    name: 'Subdomain brute force',
    category: 'Discovery',
    summary: 'Try a dictionary of names against the domain to find hosts that are not published.',
    flags: { domain: true, type: 'brt', dictionary: '/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt', threads: '10' },
    when: 'You want subdomains beyond what the records list.',
    cost: 'One query per word. Minutes, depending on the list.',
  },
  {
    id: 'crt',
    name: 'Certificate transparency',
    category: 'Discovery',
    summary: 'Pull names from crt.sh alongside the standard enumeration. Passive and high-yield.',
    flags: { domain: true, k: true },
    when: 'A quiet way to find subdomains from issued certificates.',
    cost: 'A few web requests.',
  },
  {
    id: 'reverse',
    name: 'Reverse lookup of a range',
    category: 'Discovery',
    summary: 'Resolve every address in a CIDR or range back to a name.',
    flags: { domain: true, type: 'rvl', range: '10.0.0.0/24' },
    when: 'You have a netblock and want the names behind it.',
    cost: 'One query per address.',
  },
  {
    id: 'dnssec',
    name: 'DNSSEC zone walk',
    category: 'Discovery',
    summary: 'Walk an NSEC-signed zone to enumerate names without brute force.',
    flags: { domain: true, z: true },
    when: 'The zone is DNSSEC-signed with NSEC (not NSEC3).',
    cost: 'A query per record in the chain.',
  },
  {
    id: 'json',
    name: 'Save a JSON report',
    category: 'Output',
    summary: 'Standard enumeration, written to a JSON file for the report.',
    flags: { domain: true, type: 'std', json: 'dnsrecon.json' },
    when: 'You want the output structured.',
    cost: 'Same as the enumeration it runs.',
  },
  {
    id: 'tcp-ns',
    name: 'Through a specific resolver over TCP',
    category: 'Control',
    summary: 'Query a named server over TCP, for a resolver that rate-limits UDP or for large answers.',
    flags: { domain: true, name_server: '1.1.1.1', tcp: true },
    when: 'UDP is filtered or truncated, or you want to pin the resolver.',
    cost: 'Same queries, over TCP.',
  },
];

export const alternatives = {
  type: [
    { id: 'a', when: 'you want AXFR with the standard run rather than a type on its own' },
  ],
  json: [
    { id: 'xml', when: 'the downstream tool wants XML' },
    { id: 'csv', when: 'you want a flat spreadsheet' },
  ],
  k: [
    { id: 'b', when: 'you want Bing results instead of certificate transparency' },
  ],
};
