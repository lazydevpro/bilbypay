import { mockAusdAbi } from "@bilbypay/core";
import { MockTopUpProvider, type QuoteParams, type TopUpQuote, type TopUpStatusResult } from "@bilbypay/topup";
import { type Address, encodeFunctionData, type Hex } from "viem";
import type { TxSender } from "./relayer";

/**
 * Demo/testnet top-ups: the package's mock provider, except that when a top-up completes it really
 * delivers — it mints mock USDC (a MockAUSD instance) to the recipient (our treasury) and reports that
 * transaction. TopUpService then verifies the delivery on-chain and credits AUSD exactly like it
 * would with the live provider. Only for chains where USDC_ADDRESS is a mock anyone can mint.
 */
export class DemoTopUpProvider extends MockTopUpProvider {
  private readonly recipients = new Map<string, Address>();
  private readonly delivered = new Map<string, Hex>();

  constructor(
    private readonly usdc: Address,
    private readonly sender: TxSender,
    config: ConstructorParameters<typeof MockTopUpProvider>[0] = {},
  ) {
    super(config);
  }

  override async quote(params: QuoteParams): Promise<TopUpQuote> {
    const quote = await super.quote(params);
    this.recipients.set(quote.quoteId, params.recipient);
    return quote;
  }

  override async status(id: string): Promise<TopUpStatusResult> {
    const st = await super.status(id);
    if (st.status !== "completed" || st.amountOut === undefined) return st;
    let hash = this.delivered.get(id);
    if (!hash) {
      const to = this.recipients.get(id);
      if (!to) return { ...st, destinationTxHashes: [] };
      const data = encodeFunctionData({ abi: mockAusdAbi, functionName: "mint", args: [to, st.amountOut] });
      hash = (await this.sender.send({ to: this.usdc, data, label: "demo.topup.deliver" })).hash;
      this.delivered.set(id, hash);
    }
    return { ...st, destinationTxHashes: [hash] };
  }
}
