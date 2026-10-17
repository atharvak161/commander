/** enum4linux-ng recipes. The target is a trailing host; -A does everything simple. */
export const examples = {
  target: '10.10.10.10',
};

export const recipes = [
  {
    id: 'all',
    name: 'Full simple enumeration',
    category: 'Baseline',
    summary: 'Users, groups, shares, policy, OS, printers and NetBIOS names. The default, and the first thing to run.',
    flags: { A: true },
    when: 'Any SMB host you are allowed to test. Start here.',
    cost: 'Seconds to a minute, depending on what the host exposes.',
  },
  {
    id: 'shares',
    name: 'Shares only',
    category: 'Focused',
    summary: 'List the shares over RPC, the quickest look at what is reachable.',
    flags: { S: true },
    when: 'You just want to know what is shared.',
    cost: 'Seconds.',
  },
  {
    id: 'users-groups',
    name: 'Users and groups',
    category: 'Focused',
    summary: 'Enumerate users and groups with members, the first half of building a target list.',
    flags: { U: true, Gm: true },
    when: 'You are building a user list for a password attack.',
    cost: 'Seconds.',
  },
  {
    id: 'authed',
    name: 'Authenticated enumeration',
    category: 'Coverage',
    summary: 'The full run with a known username and password, which usually reveals far more.',
    flags: { A: true, u: 'guest', p: '' },
    when: 'You have any valid credentials, even a low-privilege or guest account.',
    cost: 'Same as the full run.',
  },
  {
    id: 'rid',
    name: 'RID cycling',
    category: 'Discovery',
    summary: 'Enumerate users by cycling relative identifiers, which works even when direct enumeration is blocked.',
    flags: { R: true },
    when: 'User enumeration over RPC is refused but null sessions are allowed.',
    cost: 'A request per RID in the range.',
  },
  {
    id: 'hash',
    name: 'Pass-the-hash enumeration',
    category: 'Coverage',
    summary: 'Authenticate with an NT hash instead of a password, for a hash you recovered.',
    flags: { A: true, u: 'administrator', H: 'aad3b435b51404eeaad3b435b51404ee:...' },
    when: 'You have a hash but not the cleartext.',
    cost: 'Same as the full run.',
  },
  {
    id: 'json',
    name: 'Save a JSON report',
    category: 'Output',
    summary: 'The full enumeration, written to a JSON file for the report or further processing.',
    flags: { A: true, oJ: 'enum4linux' },
    when: 'You want the output structured.',
    cost: 'Same as the run it saves.',
  },
];

export const alternatives = {
  A: [
    { id: 'As', when: 'you want the same minus the slow NetBIOS names lookup' },
  ],
  oJ: [
    { id: 'oY', when: 'the downstream tool wants YAML' },
    { id: 'oA', when: 'you want both JSON and YAML' },
  ],
  p: [
    { id: 'H', when: 'you have an NT hash rather than a password' },
    { id: 'K', when: 'you have a Kerberos ticket' },
  ],
};
