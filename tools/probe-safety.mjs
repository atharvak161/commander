/**
 * The rules every probing tool must obey, in one place.
 *
 * verify.mjs, probe.mjs and coverage.mjs all run real binaries with real
 * flags. They must never capture traffic, reach the network, or change the
 * machine. That rule used to live in verify.mjs alone, and probe.mjs — which
 * has its own runner — therefore ran bare `tshark -V` commands that opened a
 * network interface. Nothing was captured, but it was only luck that it was
 * not a tool with worse defaults.
 *
 * So the knowledge lives here and the three import it.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* A 24-byte pcap: header, no packets. */
export const EMPTY_PCAP_BYTES = Buffer.from('d4c3b2a1020004000000000000000000ffff000001000000', 'hex');

export function writeEmptyPcap(dir) {
  const p = join(dir, 'empty.pcap');
  writeFileSync(p, EMPTY_PCAP_BYTES);
  return p;
}

/**
 * Arguments forced onto EVERY probe of a tool.
 *
 * tshark with no arguments starts capturing live traffic off the default
 * interface — the one tool here for which "no target means it does nothing"
 * is false. Reading a capture file never touches the network, so -r and an
 * empty pcap are prepended to everything.
 */
export function forcedArgs(toolId, pcapPath) {
  if (toolId === 'tshark') return ['-r', pcapPath];
  return [];
}

/**
 * Flags no probe may run, whatever the tool.
 *
 * NETWORK: these reach outside the machine. nmap's -iR is the worst of them —
 * it generates random PUBLIC IP addresses and scans them.
 * SIDE_EFFECTS: these change the machine, hang, or take minutes.
 */
export const NETWORK = new Set([
  'g', 'gpage', 'check-internet', 'tor', 'update', 'dependencies',  // sqlmap
  'iR', 'iL', 'dns-servers',                                        // nmap
  'D', 'i',                                                         // tshark: list/open interfaces
]);

export const SIDE_EFFECTS = new Set([
  'script-updatedb', 'purge', 'wizard', 'shell', 'api',
  'live-test', 'smoke-test', 'vuln-test', 'fp-test', 'payload-lint',
  'manual',
]);

export const UNSAFE = new Set([...NETWORK, ...SIDE_EFFECTS]);
