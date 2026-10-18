/** nc recipes. Host and port are trailing arguments; -l switches to listen mode. */
export const examples = {
  host: '10.10.10.10',
  port: '4444',
};

export const recipes = [
  {
    id: 'listen',
    name: 'Listen for a connection',
    category: 'Listener',
    summary: 'Open a port and wait. The catch side of a reverse shell.',
    flags: { listen: true, verbose: true, 'local-port': '4444' },
    when: 'You are catching a reverse shell or an inbound connection.',
    cost: 'Waits until something connects.',
  },
  {
    id: 'listen-udp',
    name: 'Listen on UDP',
    category: 'Listener',
    summary: 'The same, over UDP, for a UDP payload.',
    flags: { listen: true, udp: true, verbose: true, 'local-port': '4444' },
    when: 'The payload speaks UDP rather than TCP.',
    cost: 'Waits. UDP gives no connection confirmation.',
  },
  {
    id: 'connect',
    name: 'Connect to a service',
    category: 'Connect',
    summary: 'Open a raw TCP connection, for banner grabbing or talking to a service by hand.',
    flags: { verbose: true },
    when: 'You want to see what a port says, or speak a protocol manually.',
    cost: 'One connection.',
  },
  {
    id: 'scan',
    name: 'Port scan a host',
    category: 'Scan',
    summary: 'Zero-I/O mode: just report which ports are open, without sending data. Give a port range.',
    flags: { zero: true, verbose: true, 'dont-resolve': true },
    when: 'A quick check of which ports are open, when nmap is not to hand.',
    cost: 'One probe per port.',
  },
  {
    id: 'transfer-send',
    name: 'Send a file',
    category: 'Transfer',
    summary: 'Pipe a file into a connection. Pair with a listening nc redirecting to a file.',
    flags: { close: true },
    when: 'Moving a file between two machines you control, no HTTP needed.',
    cost: 'As long as the transfer takes.',
  },
  {
    id: 'quiet-connect',
    name: 'Connect with a timeout',
    category: 'Connect',
    summary: 'Connect numerically with a wait timeout, so a dead port does not hang.',
    flags: { 'dont-resolve': true, wait: '3' },
    when: 'Scripting a connection that must fail fast if nothing answers.',
    cost: 'Up to the timeout.',
  },
];

export const alternatives = {
  udp: [
    { id: 'tcp', when: 'you want TCP, which is the default anyway' },
  ],
  zero: [
    { id: 'wait', when: 'you want to cap how long a connect waits rather than scan' },
  ],
};
