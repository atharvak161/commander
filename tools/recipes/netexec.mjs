/** netexec recipes. A protocol is the mode; the target is a trailing argument. */
export const examples = {
  target: '10.10.10.0/24',
};

export const recipes = [
  {
    id: 'smb-null',
    name: 'SMB null-session enumeration',
    mode: 'smb',
    category: 'Enumeration',
    summary: 'Hit a range with no credentials to find hosts, their names, OS, and signing status.',
    flags: { u: '', p: '' },
    when: 'The first sweep of an internal range. Null sessions reveal a surprising amount.',
    cost: 'One connection per host.',
  },
  {
    id: 'smb-shares',
    name: 'SMB shares with credentials',
    mode: 'smb',
    category: 'Enumeration',
    summary: 'List the shares every host exposes to a given account, and the access level on each.',
    flags: { u: 'user', p: 'password', shares: true },
    when: 'You have credentials and want to know what they can read or write.',
    cost: 'One connection per host.',
  },
  {
    id: 'smb-spray',
    name: 'Password spray over SMB',
    mode: 'smb',
    category: 'Credentials',
    summary: 'Try one password against a list of users across the range, continuing past successes.',
    flags: { u: 'users.txt', p: 'Spring2026!', 'continue-on-success': true },
    when: 'You have a user list and one likely password, with scope for an online attack.',
    cost: 'One attempt per user per host.',
    warn: 'Spraying can lock accounts. Agree the lockout threshold in scope and stay under it.',
  },
  {
    id: 'smb-passpol',
    name: 'Dump the password policy',
    mode: 'smb',
    category: 'Enumeration',
    summary: 'Read the domain password policy so a spray respects the lockout threshold.',
    flags: { u: 'user', p: 'password', 'pass-pol': true },
    when: 'Before any spray — know the threshold first.',
    cost: 'One connection.',
  },
  {
    id: 'smb-pth',
    name: 'Pass-the-hash and run a command',
    mode: 'smb',
    category: 'Execution',
    summary: 'Authenticate with an NT hash and execute a command on every host that accepts it.',
    flags: { u: 'administrator', H: 'aad3b435...:hash', x: 'whoami' },
    when: 'You have an admin hash and want to confirm access and run something.',
    cost: 'One execution per host.',
    warn: 'Command execution on a host is intrusion. Only in scope.',
  },
  {
    id: 'ldap-users',
    name: 'LDAP user enumeration',
    mode: 'ldap',
    category: 'Enumeration',
    summary: 'Pull all domain users from LDAP, and flag accounts with no Kerberos pre-auth (AS-REP roastable).',
    flags: { u: 'user', p: 'password', 'asreproast': 'asrep.txt' },
    when: 'You have any domain credentials and want the user list plus easy roasting wins.',
    cost: 'A few LDAP queries.',
  },
  {
    id: 'winrm-exec',
    name: 'WinRM command execution',
    mode: 'winrm',
    category: 'Execution',
    summary: 'Run a command over WinRM, the cleanest remote execution when 5985 is open.',
    flags: { u: 'administrator', p: 'password', x: 'whoami /all' },
    when: 'WinRM is reachable and you have working credentials.',
    cost: 'One execution per host.',
  },
  {
    id: 'mssql-exec',
    name: 'MSSQL command via xp_cmdshell',
    mode: 'mssql',
    category: 'Execution',
    summary: 'Execute an OS command through a MSSQL server where xp_cmdshell can be enabled.',
    flags: { u: 'sa', p: 'password', 'local-auth': true, x: 'whoami' },
    when: 'You have MSSQL credentials and the account can enable xp_cmdshell.',
    cost: 'One query.',
    warn: 'Enabling xp_cmdshell changes server configuration. Only in scope.',
  },
];

export const alternatives = {
  p: [
    { id: 'H', when: 'you have an NT hash rather than a password' },
    { id: 'k', when: 'you are using Kerberos authentication' },
  ],
  x: [
    { id: 'X', when: 'you want PowerShell rather than cmd on a Windows target' },
  ],
  shares: [
    { id: 'pass-pol', when: 'you want the password policy instead of the shares' },
  ],
};
