/** wpscan recipes. The target is --url; -e chooses what to enumerate. */
export const examples = {
  target: 'https://target.example.com',
};

export const recipes = [
  {
    id: 'default',
    name: 'Standard scan',
    category: 'Baseline',
    summary: 'Point it at a WordPress site and run the default passive checks.',
    flags: { url: true },
    when: 'Any WordPress target you are allowed to test.',
    cost: 'Minutes. Passive by default, so fairly quiet.',
  },
  {
    id: 'vuln-plugins',
    name: 'Vulnerable plugins',
    category: 'Enumeration',
    summary: 'Enumerate the plugins that have known vulnerabilities. The highest-signal first pass.',
    flags: { url: true, enumerate: 'vp' },
    when: 'You want the quickest route to a known-vulnerable plugin.',
    cost: 'Minutes.',
  },
  {
    id: 'all-plugins',
    name: 'All plugins, aggressively',
    category: 'Enumeration',
    summary: 'Enumerate every plugin by brute-forcing paths, not just the popular ones.',
    flags: { url: true, enumerate: 'ap', 'plugins-detection': 'aggressive' },
    when: 'A thorough plugin inventory, when passive detection missed things.',
    cost: 'Longer and much noisier — thousands of requests.',
  },
  {
    id: 'users',
    name: 'Enumerate users',
    category: 'Enumeration',
    summary: 'Find valid usernames, the first half of a password attack.',
    flags: { url: true, enumerate: 'u' },
    when: 'You intend to follow with a password attack in scope.',
    cost: 'Quick.',
  },
  {
    id: 'password',
    name: 'Password attack',
    category: 'Credentials',
    summary: 'Try a wordlist against the users found, through the XML-RPC multicall where available.',
    flags: { url: true, 'usernames': 'admin', 'passwords': '/usr/share/wordlists/rockyou.txt', 'max-threads': '10' },
    when: 'You have scope for an online password attack and a user list.',
    cost: 'Depends entirely on the wordlist. Can be hours.',
  },
  {
    id: 'full',
    name: 'Full enumeration with API data',
    category: 'Coverage',
    summary: 'Vulnerable plugins, themes, users and config backups, with vulnerability data from the API token.',
    flags: { url: true, enumerate: 'vp,vt,u,cb,dbe', 'api-token': 'YOUR_TOKEN' },
    when: 'A complete assessment and you have a WPScan API token.',
    cost: 'Tens of minutes.',
  },
  {
    id: 'stealth',
    name: 'Quieter scan',
    category: 'Evasion',
    summary: 'Passive detection, a random user-agent per request, and throttling between requests.',
    flags: { url: true, 'detection-mode': 'passive', 'random-user-agent': true, throttle: '500' },
    when: 'There is monitoring you would rather not trip.',
    cost: 'Slower by design.',
  },
  {
    id: 'authed',
    name: 'Through a proxy',
    category: 'Coverage',
    summary: 'Route requests through an intercepting proxy so you can watch and replay them.',
    flags: { url: true, proxy: 'http://127.0.0.1:8080' },
    when: 'You want the traffic in Burp or ZAP.',
    cost: 'Limited by the proxy.',
  },
  {
    id: 'report',
    name: 'Save a JSON report',
    category: 'Output',
    summary: 'Write the findings to a file as JSON, for the report or further processing.',
    flags: { url: true, format: 'json', output: 'wpscan.json' },
    when: 'You want the output structured.',
    cost: 'Same as the scan it runs.',
  },
  {
    id: 'force',
    name: 'Force a scan',
    category: 'Coverage',
    summary: 'Skip the is-this-WordPress check and ignore a 403, for a site behind a WAF or hidden.',
    flags: { url: true, force: true, 'disable-tls-checks': true },
    when: 'wpscan refuses to start but you know it is WordPress.',
    cost: 'Same as a standard scan.',
  },
];

export const alternatives = {
  'detection-mode': [
    { id: 'plugins-detection', when: 'you want to set the aggressiveness for plugins only' },
  ],
  format: [
    { id: 'output', when: 'you only need the file, and the format can come from its extension' },
  ],
  'random-user-agent': [
    { id: 'user-agent', when: 'you want one fixed agent rather than a new one each request' },
  ],
};
