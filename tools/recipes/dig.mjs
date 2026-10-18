/** dig recipes. The name and type are trailing; +options tune the query. */
export const examples = {
  name: 'target.example.com',
  type: 'A',
};

export const recipes = [
  {
    id: 'short',
    name: 'Just the answer',
    category: 'Lookup',
    summary: 'Strip the ceremony and print only the answer records. The everyday lookup.',
    flags: { short: true },
    when: 'You want the IP or record value and nothing else.',
    cost: 'One query.',
  },
  {
    id: 'any',
    name: 'All records',
    category: 'Lookup',
    summary: 'Ask for every record type at once, to see the whole picture of a name.',
    flags: {},
    when: 'Early recon of a domain — set the type to ANY in the box.',
    cost: 'One query.',
  },
  {
    id: 'axfr',
    name: 'Zone transfer',
    category: 'High value',
    summary: 'Request a full zone transfer. A misconfigured name server hands over the entire zone.',
    flags: {},
    when: 'Always worth trying against each NS — set the type to AXFR and @ the name server.',
    cost: 'One query per name server.',
  },
  {
    id: 'trace',
    name: 'Trace the delegation',
    category: 'Analysis',
    summary: 'Follow the resolution from the root down, showing every name server on the path.',
    flags: { trace: true },
    when: 'You want to see where a name is delegated, or diagnose a resolution problem.',
    cost: 'A query at each level.',
  },
  {
    id: 'dnssec',
    name: 'DNSSEC records',
    category: 'Analysis',
    summary: 'Request the DNSSEC signatures alongside the answer.',
    flags: { dnssec: true },
    when: 'Checking whether a zone is signed, or walking an NSEC chain.',
    cost: 'One query.',
  },
  {
    id: 'reverse',
    name: 'Reverse lookup',
    category: 'Lookup',
    summary: 'Resolve an IP address back to a name. Put the address in the Name box.',
    flags: { x: 'address', short: true },
    when: 'You have an address and want the PTR record.',
    cost: 'One query.',
  },
  {
    id: 'at-resolver',
    name: 'Ask a specific resolver over TCP',
    category: 'Control',
    summary: 'Query a named server over TCP, for a large answer or a resolver that limits UDP.',
    flags: { tcp: true },
    when: 'The answer is truncated over UDP, or you want to pin the resolver (@ it in the box).',
    cost: 'One query.',
  },
  {
    id: 'bufsize',
    name: 'Large EDNS buffer',
    category: 'Control',
    summary: 'Advertise a large UDP buffer so a big answer is not truncated.',
    flags: { bufsize: '1232' },
    when: 'A DNSSEC or ANY answer is coming back truncated.',
    cost: 'One query.',
  },
];

export const alternatives = {
  short: [
    { id: 'all', when: 'you want to control exactly which sections show with +answer etc.' },
  ],
  tcp: [
    { id: 'vc', when: 'you prefer the virtual-circuit spelling, which means the same' },
  ],
  trace: [
    { id: 'dnssec', when: 'you want the signatures rather than the delegation path' },
  ],
};
