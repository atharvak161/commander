/** john recipes. The hash file is a trailing argument; a mode flag chooses the attack. */
export const examples = {
  target: 'hashes.txt',
};

export const recipes = [
  {
    id: 'wordlist',
    name: 'Wordlist attack with rules',
    category: 'Attack',
    summary: 'Try a wordlist with mangling rules applied. The standard first crack.',
    flags: { wordlist: '/usr/share/wordlists/rockyou.txt', rules: true },
    when: 'Any hash file. Rules turn one word into hundreds of likely variants.',
    cost: 'Minutes to hours, depending on the list and the hash speed.',
  },
  {
    id: 'single',
    name: 'Single crack mode',
    category: 'Attack',
    summary: 'Use the login names and GECOS fields from the file itself as candidates. Fast and high-yield.',
    flags: { single: true },
    when: 'Always worth running first — people base passwords on their own username.',
    cost: 'Fast.',
  },
  {
    id: 'format',
    name: 'Force a hash format',
    category: 'Control',
    summary: 'Tell john exactly which format the hashes are, when auto-detection is wrong or ambiguous.',
    flags: { format: 'raw-md5', wordlist: '/usr/share/wordlists/rockyou.txt' },
    when: 'john guesses the wrong format, or several formats match the same hash.',
    cost: 'Same as the attack it runs.',
  },
  {
    id: 'incremental',
    name: 'Incremental (brute force)',
    category: 'Attack',
    summary: 'Try every combination in a character set. The last resort when wordlists fail.',
    flags: { incremental: true },
    when: 'Short passwords, or nothing else worked. Can run effectively forever.',
    cost: 'Open-ended — runs until you stop it or it exhausts the keyspace.',
  },
  {
    id: 'mask',
    name: 'Mask attack',
    category: 'Attack',
    summary: 'Brute force a known pattern, like eight lowercase letters, far faster than full incremental.',
    flags: { mask: '?l?l?l?l?l?l?l?l' },
    when: 'You know the password shape — a length, a prefix, a date.',
    cost: 'Depends on the mask size.',
  },
  {
    id: 'show',
    name: 'Show cracked passwords',
    category: 'Output',
    summary: 'Print the passwords already cracked for this file from the pot file. No cracking.',
    flags: { show: true },
    when: 'After a run, to read what fell.',
    cost: 'Instant.',
  },
  {
    id: 'fork',
    name: 'Use all cores',
    category: 'Performance',
    summary: 'Fork across CPU cores to crack in parallel.',
    flags: { fork: '4', wordlist: '/usr/share/wordlists/rockyou.txt' },
    when: 'A slow hash and a machine with cores to spare.',
    cost: 'Faster, at full CPU.',
  },
];

export const alternatives = {
  wordlist: [
    { id: 'single', when: 'you want the fast username-based pass first' },
    { id: 'incremental', when: 'the wordlist is exhausted and you must brute force' },
  ],
  incremental: [
    { id: 'mask', when: 'you know the password shape and can brute force it far faster' },
  ],
  rules: [
    { id: 'rules-stack', when: 'you want to stack a second rule set after the first' },
  ],
};
