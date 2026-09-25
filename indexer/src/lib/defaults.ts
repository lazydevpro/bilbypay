// Zero-value entity constructors.
import type { Account, BurrowPosition, DailyStats, GlobalStats, Phone } from "envio";
import { dayDate, emptyHistogram, WAD } from "./stats.js";

export const GLOBAL_ID = "global";

export function newAccount(id: string, timestamp: number): Account {
  return {
    id,
    phoneKey: undefined,
    phone_id: undefined,
    isBound: false,
    firstBoundAt: undefined,
    boundAt: undefined,
    reboundAt: undefined,
    bindingCount: 0,
    ausdIn: 0n,
    ausdOut: 0n,
    ausdNetFlow: 0n,
    sentCount: 0,
    sentVolume: 0n,
    receivedCount: 0,
    receivedVolume: 0n,
    giftsSentCount: 0,
    giftsSentVolume: 0n,
    giftsReceivedCount: 0,
    pendingOutgoing: 0n,
    autoSaveEnabled: false,
    autoSaveThreshold: 0n,
    firstSeenAt: timestamp,
    lastActiveAt: timestamp,
  };
}

export function newPhone(id: string): Phone {
  return {
    id,
    account_id: undefined,
    boundAt: undefined,
    bindCount: 0,
    rebindCount: 0,
    lastReboundAt: undefined,
    escrowReceivedCount: 0,
    escrowReceivedVolume: 0n,
  };
}

export function newBurrowPosition(account: string, timestamp: number): BurrowPosition {
  return {
    id: account,
    account_id: account,
    shares: 0n,
    depositedAssets: 0n,
    withdrawnAssets: 0n,
    netDeposited: 0n,
    valueEstimate: 0n,
    earnedEstimate: 0n,
    sweepCount: 0,
    sweptAssets: 0n,
    addCount: 0,
    addedAssets: 0n,
    breakCount: 0,
    brokenAssets: 0n,
    lastBurnTx: undefined,
    lastVaultEvent_id: undefined,
    updatedAt: timestamp,
  };
}

export function newDailyStats(day: number): DailyStats {
  return {
    id: dayDate(day),
    day,
    date: dayDate(day),
    activeAccounts: 0,
    newAccounts: 0,
    newBindings: 0,
    rebinds: 0,
    paymentsCount: 0,
    paymentsVolume: 0n,
    directTransferCount: 0,
    directTransferVolume: 0n,
    externalInVolume: 0n,
    externalOutVolume: 0n,
    escrowDepositCount: 0,
    escrowDepositVolume: 0n,
    escrowClaimCount: 0,
    escrowClaimVolume: 0n,
    escrowRefundCount: 0,
    escrowRefundVolume: 0n,
    escrowCancelCount: 0,
    escrowCancelVolume: 0n,
    giftCount: 0,
    giftVolume: 0n,
    timeToClaimSum: 0n,
    timeToClaimCount: 0,
    burrowInVolume: 0n,
    burrowOutVolume: 0n,
    autoSaveSweeps: 0,
  };
}

export function newGlobalStats(): GlobalStats {
  return {
    id: GLOBAL_ID,
    accounts: 0,
    boundPhones: 0,
    bindings: 0,
    rebinds: 0,
    paymentsCount: 0,
    paymentsVolume: 0n,
    directTransferCount: 0,
    directTransferVolume: 0n,
    externalInVolume: 0n,
    externalOutVolume: 0n,
    escrowDepositCount: 0,
    escrowDepositVolume: 0n,
    escrowPendingCount: 0,
    escrowPendingValue: 0n,
    escrowClaimCount: 0,
    escrowClaimVolume: 0n,
    escrowRefundCount: 0,
    escrowCancelCount: 0,
    claimRate: 0,
    giftCount: 0,
    giftVolume: 0n,
    timeToClaimSum: 0n,
    timeToClaimCount: 0,
    avgTimeToClaim: 0,
    timeToClaimHistogram: emptyHistogram(),
    medianTimeToClaim: 0,
    p90TimeToClaim: 0,
    burrowAccounts: 0,
    burrowShares: 0n,
    burrowNetDeposited: 0n,
    burrowTvlEstimate: 0n,
    autoSaveEnabledCount: 0,
    sharePriceWad: WAD,
    updatedAt: 0,
  };
}
