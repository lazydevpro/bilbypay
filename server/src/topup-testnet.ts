import { mockAusdAbi } from "@bilbypay/core";
import type { QuoteParams, TopUpOrigin, TopUpProvider, TopUpQuote, TopUpStatusResult } from "@bilbypay/topup";
import { type Address, encodeFunctionData, type Hex } from "viem";
import type { TxSender } from "./relayer";

/**
 * Testnet only: wraps the mock top-up provider so a "completed" top-up really delivers test USDC to the
 * treasury on-chain (an open-mint test token), the way the real provider delivers USDC on mainnet.
 * The server then verifies that delivery through its normal path (receipt → USDC Transfer → treasury),
 * so Add money is exercised end to end with no verification shortcut.
 */
export class TestnetDeliveringTopUpProvider implements TopUpProvider {
  readonly name: string;
  private readonly recipients = new Map<string, Address>();
  private readonly deliveries = new Map<string, Promise<Hex>>();

  constructor(
    private readonly inner: TopUpProvider,
    private readonly usdc: Address,
    private readonly sender: TxSender,
  ) {
    this.name = `${inner.name}+testnet-delivery`;
  }

  supportedOrigins(): TopUpOrigin[] {
    return this.inner.supportedOrigins();
  }

  async quote(params: QuoteParams): Promise<TopUpQuote> {
    const q = await this.inner.quote(params);
    this.recipients.set(q.quoteId, params.recipient as Address);
    return q;
  }

  async status(quoteId: string): Promise<TopUpStatusResult> {
    const st = await this.inner.status(quoteId);
    const recipient = this.recipients.get(st.quoteId);
    if (st.status !== "completed" || st.amountOut === undefined || !recipient) return st;
    let delivery = this.deliveries.get(st.quoteId);
    if (!delivery) {
      delivery = this.sender
        .send({
          to: this.usdc,
          data: encodeFunctionData({ abi: mockAusdAbi, functionName: "mint", args: [recipient, st.amountOut] }),
          label: "topup.testnetDelivery",
        })
        .then((s) => s.hash);
      // A failed delivery is retried on the next status poll.
      delivery.catch(() => this.deliveries.delete(st.quoteId));
      this.deliveries.set(st.quoteId, delivery);
    }
    return { ...st, destinationTxHashes: [await delivery] };
  }

  submitDepositTx(params: { quoteId: string; txHash: string }) {
    return this.inner.submitDepositTx?.(params) ?? Promise.resolve();
  }
}
