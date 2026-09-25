// Exact message formats from docs/api.md. These are protocol strings, never shown in the UI.
// glossary-allow-file

export function registerMessage(phone: string, address: string, issuedAt: number): string {
  return `BilbyPay: link phone to this account\nPhone: ${phone}\nAccount: ${address}\nIssued: ${issuedAt}`;
}

export function sessionMessage(address: string, issuedAt: number): string {
  return `BilbyPay: sign in\nAccount: ${address}\nIssued: ${issuedAt}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
