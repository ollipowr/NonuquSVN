export interface CheckoutArgsInput {
  url: string;
  target: string;
  username?: string;
  password?: string;
}

/** Builds argv for `svn checkout`. Passed as an argument array (no shell), so credentials go verbatim; only NUL is invalid. */
export function buildCheckoutArgs({
  url,
  target,
  username,
  password,
}: CheckoutArgsInput): string[] {
  const args = [
    'checkout',
    url,
    target,
    '--non-interactive',
    '--trust-server-cert-failures=unknown-ca',
  ];
  if (username) {
    args.push('--username', username, '--password', password ?? '');
  }
  if (args.some((a) => a.includes('\u0000'))) {
    // Generic on purpose: never echo the value back, it may be a password.
    throw new Error('Invalid characters in credentials');
  }
  return args;
}
