/**
 * openssl recipes, grouped by subcommand (the mode each one runs in).
 *
 * Every flag id used here was read from that subcommand's own -help, so the
 * gate can confirm each recipe against the mode it names. Recipes that reach the
 * network (anything with -connect) are skipped during verification, like every
 * other side-effecting recipe, but they still build correctly in the UI.
 */

/* Trailing positionals, one per mode that takes one. Values are withheld during
   verification; these just give the UI a labelled box and an example. */
export const trailing = {
  genrsa: { id: 'numbits', label: 'Key size (bits)', kind: 'string', placeholder: '2048',
    usage: '[numbits]', help: 'Size of the RSA key in bits, as the trailing argument (default 2048).' },
  ciphers: { id: 'cipherstr', label: 'Cipher string', kind: 'string', placeholder: 'ECDHE+AESGCM',
    usage: '[cipherstring]', help: 'An OpenSSL cipher string to expand, as the trailing argument.' },
  prime: { id: 'number', label: 'Number', kind: 'string', placeholder: '7919',
    usage: '[number]', help: 'The number to test for primality, as the trailing argument (decimal, or hex with -hex).' },
  mac: { id: 'mac_name', label: 'MAC name', kind: 'string', placeholder: 'HMAC',
    usage: 'mac_name', help: 'The MAC algorithm: HMAC, CMAC, GMAC, KMAC-128, Poly1305.' },
  kdf: { id: 'kdf_name', label: 'KDF name', kind: 'string', placeholder: 'HKDF',
    usage: 'kdf_name', help: 'The KDF algorithm: HKDF, PBKDF2, SCRYPT, SSKDF, TLS1-PRF.' },
  passwd: { id: 'password', label: 'Password', kind: 'string', placeholder: 'secret',
    usage: '[password]', help: 'The password to hash, as the trailing argument (omit to read from a prompt).' },
};

export const examples = {
  numbits: '2048',
  cipherstr: 'ECDHE+AESGCM',
  number: '7919',
  mac_name: 'HMAC',
  kdf_name: 'HKDF',
};

export const recipes = [
  /* ---- s_client: the headline, inspecting a live TLS service ---- */
  {
    id: 's_client-cert', mode: 's_client',
    name: 'Inspect a server certificate', category: 'TLS',
    summary: 'Open a TLS connection and print the full certificate chain the server presents.',
    flags: { connect: 'example.com:443', servername: 'example.com', showcerts: true },
    when: 'First look at any HTTPS or TLS service: what cert, what chain, what issuer.',
    cost: 'One connection.',
  },
  {
    id: 's_client-starttls', mode: 's_client',
    name: 'STARTTLS on a mail service', category: 'TLS',
    summary: 'Negotiate STARTTLS on an SMTP/IMAP/POP3 port, then inspect the certificate.',
    flags: { connect: 'mail.example.com:25', starttls: 'smtp' },
    when: 'The service upgrades to TLS mid-protocol (SMTP 25/587, IMAP 143, POP3 110).',
    cost: 'One connection.',
  },
  {
    id: 's_client-proto', mode: 's_client',
    name: 'Force a protocol version', category: 'TLS',
    summary: 'Pin the handshake to one TLS version to see whether the server still allows it.',
    flags: { connect: 'example.com:443', tls1_2: true },
    when: 'Checking for legacy TLS 1.0/1.1 support, or confirming TLS 1.3.',
    cost: 'One connection.',
  },

  /* ---- x509: reading and converting certificates ---- */
  {
    id: 'x509-read', mode: 'x509',
    name: 'Read a certificate', category: 'Certificates',
    summary: 'Print a certificate in human-readable text without re-emitting the certificate.',
    flags: { in: 'cert.pem', text: true, noout: true },
    when: 'You have a .pem/.crt on disk and want its subject, SANs, dates and issuer.',
    cost: 'Local, instant.',
  },
  {
    id: 'x509-fingerprint', mode: 'x509',
    name: 'Fingerprint and dates', category: 'Certificates',
    summary: 'Print the certificate fingerprint and validity window only.',
    flags: { in: 'cert.pem', fingerprint: true, dates: true, noout: true },
    when: 'Pinning a cert, or checking expiry at a glance.',
    cost: 'Local, instant.',
  },
  {
    id: 'x509-pem2der', mode: 'x509',
    name: 'PEM to DER', category: 'Certificates',
    summary: 'Convert a certificate from PEM (base64) to DER (binary).',
    flags: { in: 'cert.pem', inform: 'PEM', outform: 'DER', out: 'cert.der' },
    when: 'A tool wants DER, or you want the raw bytes.',
    cost: 'Local, instant.',
  },

  /* ---- req: CSRs and self-signed certs ---- */
  {
    id: 'req-selfsigned', mode: 'req',
    name: 'Self-signed cert + key', category: 'Certificates',
    summary: 'Generate a fresh key and a self-signed certificate in one command.',
    flags: { new: true, x509: true, newkey: 'rsa:2048', keyout: 'key.pem', out: 'cert.pem', days: '365', noenc: true },
    when: 'Standing up a quick TLS listener for a lab or a callback.',
    cost: 'Local, a key generation.',
  },
  {
    id: 'req-csr', mode: 'req',
    name: 'New CSR + key', category: 'Certificates',
    summary: 'Generate a key and a certificate signing request to hand to a CA.',
    flags: { new: true, newkey: 'rsa:2048', keyout: 'key.pem', out: 'req.csr', noenc: true },
    when: 'Requesting a signed certificate.',
    cost: 'Local, a key generation.',
  },
  {
    id: 'req-read', mode: 'req',
    name: 'Read a CSR', category: 'Certificates',
    summary: 'Print the contents of a certificate signing request.',
    flags: { in: 'req.csr', text: true, noout: true },
    when: 'Confirming what a CSR actually asks for.',
    cost: 'Local, instant.',
  },

  /* ---- keys ---- */
  {
    id: 'genrsa-key', mode: 'genrsa',
    name: 'Generate an RSA key', category: 'Keys',
    summary: 'Write a new RSA private key. Set the size in the trailing box.',
    flags: { out: 'key.pem' },
    when: 'You need a private key and nothing fancier.',
    cost: 'Local, a key generation.',
  },
  {
    id: 'rsa-inspect', mode: 'rsa',
    name: 'Inspect an RSA key', category: 'Keys',
    summary: 'Print the components of an RSA key without re-emitting it.',
    flags: { in: 'key.pem', text: true, noout: true },
    when: 'Checking a key you were handed.',
    cost: 'Local, instant.',
  },
  {
    id: 'pkey-pubout', mode: 'pkey',
    name: 'Extract the public key', category: 'Keys',
    summary: 'Derive the public key from any private key.',
    flags: { in: 'key.pem', pubout: true, out: 'pub.pem' },
    when: 'You need the public half to share or to pin.',
    cost: 'Local, instant.',
  },
  {
    id: 'pkeyutl-sign', mode: 'pkeyutl',
    name: 'Sign a file', category: 'Keys',
    summary: 'Produce a signature over a file with a private key.',
    flags: { sign: true, inkey: 'key.pem', in: 'data.bin', out: 'data.sig' },
    when: 'Signing data or a digest.',
    cost: 'Local, instant.',
  },

  /* ---- crypto primitives ---- */
  {
    id: 'dgst-hmac', mode: 'dgst',
    name: 'HMAC of a file', category: 'Hashing',
    summary: 'Compute a keyed HMAC over a file, printed as hex.',
    flags: { hmac: 'secretkey', hex: true },
    when: 'Verifying message integrity with a shared key.',
    cost: 'Local, instant.',
  },
  {
    id: 'dgst-sign', mode: 'dgst',
    name: 'Sign a file', category: 'Hashing',
    summary: 'Hash a file and sign the digest with a private key.',
    flags: { sign: 'key.pem', out: 'file.sig' },
    when: 'Producing a detached signature.',
    cost: 'Local, instant.',
  },
  {
    id: 'enc-encrypt', mode: 'enc',
    name: 'Encrypt a file', category: 'Encryption',
    summary: 'Symmetric-encrypt a file with a passphrase-derived key and base64 the output.',
    flags: { e: true, a: true, salt: true, pbkdf2: true, in: 'plain.txt', out: 'cipher.b64' },
    when: 'Protecting a file with a passphrase. Add the cipher with the ad-hoc box (e.g. -aes-256-cbc).',
    cost: 'Local, instant.',
  },
  {
    id: 'passwd-sha512', mode: 'passwd',
    name: 'SHA-512 crypt hash', category: 'Passwords',
    summary: 'Hash a password in the /etc/shadow SHA-512 crypt form.',
    flags: { '6': true },
    when: 'Seeding a Unix password, or cracking practice.',
    cost: 'Local, instant.',
  },
  {
    id: 'passwd-apr1', mode: 'passwd',
    name: 'Apache apr1 hash', category: 'Passwords',
    summary: 'Hash a password in the Apache htpasswd (apr1) form.',
    flags: { apr1: true },
    when: 'Writing an .htpasswd entry.',
    cost: 'Local, instant.',
  },
  {
    id: 'rand-hex', mode: 'rand',
    name: 'Random hex', category: 'Random',
    summary: 'Emit cryptographically strong random bytes as hex. Set the count in the trailing box.',
    flags: { hex: true },
    when: 'A token, a key, an IV, a nonce.',
    cost: 'Local, instant.',
  },
  {
    id: 'prime-generate', mode: 'prime',
    name: 'Generate a prime', category: 'Math',
    summary: 'Generate a random prime of a given bit length.',
    flags: { generate: true, bits: '256' },
    when: 'You need a prime for a toy RSA or a CTF.',
    cost: 'Local, instant.',
  },

  /* ---- containers ---- */
  {
    id: 'pkcs12-export', mode: 'pkcs12',
    name: 'Bundle key + cert to .p12', category: 'Containers',
    summary: 'Pack a private key and its certificate into a PKCS#12 file.',
    flags: { export: true, inkey: 'key.pem', in: 'cert.pem', out: 'bundle.p12' },
    when: 'Importing into Windows, a browser, or Java.',
    cost: 'Local, instant.',
  },
  {
    id: 'pkcs12-extract', mode: 'pkcs12',
    name: 'Extract from a .p12', category: 'Containers',
    summary: 'Pull the keys and certificates out of a PKCS#12 bundle, unencrypted.',
    flags: { in: 'bundle.p12', out: 'out.pem', noenc: true },
    when: 'You have a .p12/.pfx and need the PEM parts.',
    cost: 'Local, instant.',
  },
  {
    id: 'asn1-dump', mode: 'asn1parse',
    name: 'Dump ASN.1 structure', category: 'Analysis',
    summary: 'Walk the ASN.1 structure of a DER or PEM file, field by field.',
    flags: { in: 'cert.der', inform: 'DER' },
    when: 'Understanding an unknown certificate, key or signature blob.',
    cost: 'Local, instant.',
  },

  /* ---- cert-adjacent ---- */
  {
    id: 'verify-chain', mode: 'verify',
    name: 'Verify a chain', category: 'Certificates',
    summary: 'Check a certificate against a trusted CA bundle and show the chain.',
    flags: { CAfile: 'ca-bundle.pem', show_chain: true },
    when: 'Confirming whether a cert validates and why it does not.',
    cost: 'Local, instant.',
  },
  {
    id: 'crl-read', mode: 'crl',
    name: 'Read a CRL', category: 'Certificates',
    summary: 'Print a certificate revocation list in text form.',
    flags: { in: 'list.crl', text: true, noout: true },
    when: 'Checking what a CRL revokes and when it next updates.',
    cost: 'Local, instant.',
  },
  {
    id: 'ciphers-list', mode: 'ciphers',
    name: 'Expand a cipher string', category: 'TLS',
    summary: 'Show, verbosely, exactly which cipher suites a string selects.',
    flags: { v: true },
    when: 'Working out what a server config actually enables.',
    cost: 'Local, instant.',
  },
];

export const alternatives = {
  noenc: [{ id: 'nodes', when: 'you prefer the old -nodes spelling, which means the same' }],
};
