/**
 * nmap recipes — complete commands for the jobs people actually do.
 *
 * Each one is a set of flags and values that buildCommand turns into a real
 * command, so they are quoted, ordered and verified exactly like a command you
 * build yourself. `when` says what the recipe is for; `cost` warns about the
 * ones that take a long time or make a lot of noise.
 */
export const examples = { target: 'scanme.nmap.org' };

export const recipes = [
  /* ---------------------------------------------------------- everyday --- */
  {
    id: 'quick',
    name: 'Quick look',
    category: 'Everyday',
    summary: 'The 1,000 most common ports, with service names. Where most scans should start.',
    flags: { sT: true, 'top-ports': '1000', sV: true, T4: true },
    when: 'You want to know what is listening, now, and you do not have root.',
    cost: 'Seconds to a minute.',
  },
  {
    id: 'full-tcp',
    name: 'Every TCP port',
    category: 'Everyday',
    summary: 'All 65,535 ports. Slower, but the only way to find a service hiding high up.',
    flags: { sS: true, p: '-', T4: true, Pn: true },
    when: 'The quick look found little and you suspect something on an odd port.',
    cost: 'Minutes. Needs root for -sS.',
  },
  {
    id: 'service-os',
    name: 'Services and operating system',
    category: 'Everyday',
    summary: 'Version detection plus OS fingerprinting on the common ports.',
    flags: { sS: true, sV: true, O: true, 'top-ports': '1000', T4: true },
    when: 'You know what is open and now want to know what it is running.',
    cost: 'A few minutes. Needs root.',
  },
  {
    id: 'aggressive',
    name: 'Everything at once',
    category: 'Everyday',
    summary: '-A turns on OS detection, version detection, default scripts and traceroute together.',
    flags: { A: true, p: '-', T4: true },
    when: 'An authorised box you control, and you want the full picture in one command.',
    cost: 'Slow and very loud. Needs root.',
  },

  /* --------------------------------------------------------- discovery --- */
  {
    id: 'ping-sweep',
    name: 'Which hosts are up',
    category: 'Discovery',
    summary: 'Host discovery only — no port scan. Maps a subnet before you scan anything in it.',
    flags: { sn: true },
    examples: { target: '192.168.1.0/24' },
    when: 'First command against a new network.',
    cost: 'Fast.',
  },
  {
    id: 'no-ping',
    name: 'Scan hosts that ignore ping',
    category: 'Discovery',
    summary: 'Skips discovery and scans anyway. Firewalls often drop ICMP while leaving ports open.',
    flags: { Pn: true, sS: true, 'top-ports': '1000', T4: true },
    when: 'nmap says "host seems down" but you know it is not.',
    cost: 'Slower, because nothing is skipped early. Needs root.',
  },
  {
    id: 'list-only',
    name: 'List targets without touching them',
    category: 'Discovery',
    summary: 'Expands the target specification and resolves names. Sends nothing to the hosts.',
    flags: { sL: true },
    examples: { target: '192.168.1.0/24' },
    when: 'Checking that a range means what you think before you scan it.',
    cost: 'Instant, and nothing reaches the targets.',
  },

  /* ----------------------------------------------------------- stealth --- */
  {
    id: 'stealth-slow',
    name: 'Slow and quiet',
    category: 'Stealth and evasion',
    summary: 'SYN scan at the sneaky timing template, which waits between probes to stay under rate-based detection.',
    flags: { sS: true, T2: true, 'top-ports': '100', Pn: true },
    when: 'The target has monitoring and you would rather not trip it.',
    cost: 'Minutes to hours — that is the point. Needs root.',
  },
  {
    id: 'fragment',
    name: 'Fragmented packets',
    category: 'Stealth and evasion',
    summary: 'Splits probes into tiny IP fragments, which some older filters fail to reassemble.',
    flags: { sS: true, f: true, 'top-ports': '100', Pn: true },
    when: 'A packet filter is dropping ordinary probes.',
    cost: 'Needs root. Modern firewalls reassemble, so expect this to be detected.',
  },
  {
    id: 'decoy',
    name: 'Hide among decoys',
    category: 'Stealth and evasion',
    summary: 'Sends probes that appear to come from other addresses as well as yours, so the log is crowded.',
    flags: { sS: true, D: 'RND:5', 'top-ports': '100', Pn: true },
    when: 'You want your address to be one of several in the target\'s logs.',
    cost: 'Needs root. Your real address is still in there.',
  },
  {
    id: 'source-port',
    name: 'Come from a trusted port',
    category: 'Stealth and evasion',
    summary: 'Sets the source port to 53. Some firewalls trust DNS traffic by rule.',
    flags: { sS: true, g: '53', 'top-ports': '100', Pn: true },
    when: 'Egress or ingress rules appear to be port-based.',
    cost: 'Needs root.',
  },

  /* ----------------------------------------------------------- scripts --- */
  {
    id: 'default-scripts',
    name: 'Default scripts',
    category: 'Scripts and vulnerabilities',
    summary: 'Runs NSE\'s default set against open ports — banners, titles, certificates, shares.',
    flags: { sS: true, sC: true, sV: true, 'top-ports': '1000', T4: true },
    when: 'Standard follow-up once you know what is open.',
    cost: 'A few minutes. Needs root.',
  },
  {
    id: 'vuln-scripts',
    name: 'Known vulnerability checks',
    category: 'Scripts and vulnerabilities',
    summary: 'Runs the vuln category, which tests for specific published weaknesses.',
    flags: { sS: true, sV: true, script: 'vuln', 'top-ports': '1000', T4: true },
    when: 'You have authorisation and want known issues flagged automatically.',
    cost: 'Slow, noisy, and some scripts are intrusive. Needs root.',
  },
  {
    id: 'smb-enum',
    name: 'Windows and SMB shares',
    category: 'Scripts and vulnerabilities',
    summary: 'Targets the SMB ports and runs the SMB enumeration scripts.',
    flags: { sS: true, sV: true, p: '139,445', script: 'smb-enum-shares,smb-enum-users,smb-os-discovery' },
    when: 'A Windows host or a file server is in scope.',
    cost: 'Fast. Needs root.',
  },

  /* ------------------------------------------------------------ output --- */
  {
    id: 'save-all',
    name: 'Save the results',
    category: 'Output',
    summary: 'Writes normal, XML and grepable output at once, so you can read it now and parse it later.',
    flags: { sS: true, sV: true, 'top-ports': '1000', T4: true, oA: 'scan' },
    when: 'Any scan whose results you will need again — which is most of them.',
    cost: 'Needs root. Writes scan.nmap, scan.xml and scan.gnmap.',
  },
  {
    id: 'udp-top',
    name: 'Common UDP ports',
    category: 'Everyday',
    summary: 'UDP is slow to scan and easy to forget, and DNS, SNMP and TFTP all live there.',
    flags: { sU: true, 'top-ports': '100', T4: true },
    when: 'A TCP scan came back thin, or you are after DNS/SNMP specifically.',
    cost: 'Slow even at 100 ports — UDP has no handshake to speed things up. Needs root.',
  },
];

/** Other flags that do the same job, shown in a recipe's breakdown. */
export const alternatives = {
  T4: [
    { id: 'T2', when: 'you want to stay under rate-based detection' },
    { id: 'T5', when: 'the target is on your own fast network' },
    { id: 'T3', when: 'you want nmap\'s default pacing' },
  ],
  T2: [
    { id: 'T1', when: 'even slower, for IDS evasion' },
    { id: 'T4', when: 'you no longer care about being quiet' },
  ],
  sS: [
    { id: 'sT', when: 'you do not have root — connect scan needs no raw sockets' },
    { id: 'sU', when: 'you want UDP instead of TCP' },
    { id: 'sA', when: 'you are mapping firewall rules rather than finding services' },
  ],
  sT: [{ id: 'sS', when: 'you have root — SYN is faster and half-open' }],
  p: [
    { id: 'F', when: 'you only want the top 100 ports' },
    { id: 'top-ports', when: 'you want the N most common rather than a range' },
  ],
  'top-ports': [{ id: 'p', when: 'you want to name exact ports or scan all of them with -' }],
  sC: [{ id: 'script', when: 'you want a specific script or category instead of the default set' }],
  O: [{ id: 'A', when: 'you also want version detection, scripts and traceroute' }],
  f: [{ id: 'mtu', when: 'you want to choose the fragment size yourself' }],
  oA: [
    { id: 'oN', when: 'you only want the human-readable file' },
    { id: 'oX', when: 'you only want XML, for tooling' },
    { id: 'oG', when: 'you want grepable output' },
  ],
};
