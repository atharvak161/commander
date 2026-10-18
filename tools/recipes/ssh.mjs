/**
 * ssh recipes. The destination (and an optional command) are trailing; the
 * flags here are the patterns that actually come up: tunnels, pivots, key auth,
 * and the lab-only host-key bypass.
 *
 * None of these connect during verification: the destination is withheld, so
 * ssh stops at "usage:" having opened no socket.
 */
export const examples = {
  destination: 'user@host',
  command: 'id; uname -a',
};

export const recipes = [
  {
    id: 'local-forward', mode: 'default',
    name: 'Local port forward', category: 'Tunnels',
    summary: 'Expose a remote service on a local port: -L localport:remotehost:remoteport.',
    flags: { L: '8080:localhost:80', N: true },
    when: 'Reach a service bound to localhost on the remote, or behind it, from your machine.',
    cost: 'One connection, held open.',
  },
  {
    id: 'dynamic-socks', mode: 'default',
    name: 'Dynamic SOCKS proxy', category: 'Tunnels',
    summary: 'Turn the SSH session into a SOCKS proxy: point a browser or proxychains at it.',
    flags: { D: '1080', N: true },
    when: 'Pivoting: route arbitrary tools through the remote host.',
    cost: 'One connection, held open.',
  },
  {
    id: 'remote-forward', mode: 'default',
    name: 'Remote port forward', category: 'Tunnels',
    summary: 'Expose a local service on a port of the remote host: -R remoteport:localhost:localport.',
    flags: { R: '9000:localhost:3000', N: true },
    when: 'A callback or a service on your box that the remote side needs to reach.',
    cost: 'One connection, held open.',
  },
  {
    id: 'jump', mode: 'default',
    name: 'Pivot through a jump host', category: 'Pivoting',
    summary: 'Reach a target that is only routable from a bastion, in one command.',
    flags: { J: 'bastion.example.com' },
    when: 'The target sits behind a jump box you can reach.',
    cost: 'Two hops, one command.',
  },
  {
    id: 'key-port', mode: 'default',
    name: 'Key and non-standard port', category: 'Auth',
    summary: 'Authenticate with a specific private key, on a port other than 22.',
    flags: { i: '~/.ssh/id_ed25519', p: '2222' },
    when: 'You have a key file and the service is not on 22.',
    cost: 'One connection.',
  },
  {
    id: 'run-command', mode: 'default',
    name: 'Run one command', category: 'Execution',
    summary: 'Run a single command and return, no interactive shell (-T, no PTY).',
    flags: { T: true },
    when: 'Scripting over SSH, or grabbing one piece of output.',
    cost: 'One connection. Put the command in the box.',
  },
  {
    id: 'force-tty', mode: 'default',
    name: 'Force a TTY', category: 'Execution',
    summary: 'Force pseudo-terminal allocation to spawn an interactive program on a restricted shell.',
    flags: { t: true },
    when: 'Upgrading to a real shell, or running something that demands a TTY.',
    cost: 'One connection.',
  },
  {
    id: 'agent-forward', mode: 'default',
    name: 'Forward the agent', category: 'Auth',
    summary: 'Forward your SSH agent so the next hop can authenticate with your keys.',
    flags: { A: true },
    when: 'Chaining to a further host with the same key, without copying it. Trust the host first.',
    cost: 'One connection.',
  },
  {
    id: 'lab-nohostkey', mode: 'default',
    name: 'Skip host-key checks (lab)', category: 'Options',
    summary: 'Do not verify or save the host key. For throwaway lab boxes only, never production.',
    flags: { o: 'StrictHostKeyChecking=no' },
    when: 'A CTF or lab host whose key churns. Do not use this where the host identity matters.',
    cost: 'One connection.',
  },
  {
    id: 'verbose', mode: 'default',
    name: 'Debug the handshake', category: 'Diagnostics',
    summary: 'Print the negotiation, auth attempts and config decisions. Add more -v for more.',
    flags: { v: true },
    when: 'An auth or connection failure you need to understand.',
    cost: 'One connection.',
  },
  {
    id: 'print-config', mode: 'default',
    name: 'Show the effective config', category: 'Diagnostics',
    summary: 'Print the configuration ssh would use for a destination, after evaluating the config files.',
    flags: { G: true },
    when: 'Working out which Host block and options actually apply.',
    cost: 'Local, no connection.',
  },
  {
    id: 'query-ciphers', mode: 'default',
    name: 'List supported algorithms', category: 'Diagnostics',
    summary: 'List the ciphers (or MACs, kex, keys) this client supports, and exit.',
    flags: { Q: 'cipher' },
    when: 'Checking what the client can negotiate. No destination needed.',
    cost: 'Local, no connection.',
  },
];

export const alternatives = {
  L: [{ id: 'D', when: 'you want a general SOCKS proxy rather than one fixed remote port' }],
  T: [{ id: 't', when: 'the remote program needs a TTY (forces allocation instead of disabling it)' }],
};
