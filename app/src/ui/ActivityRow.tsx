import { router } from "expo-router";
import type { ActivityItem } from "../api/types";
import { firstName } from "../flows/drafts";
import { usd } from "../money/amount";
import { Avatar } from "./Avatar";
import { Row } from "./Row";
import { colors } from "./theme";

const INCOMING = new Set<ActivityItem["kind"]>(["received", "gift_received", "refund", "burrow_out"]);

export function activityTitle(it: ActivityItem): string {
  const who = it.counterparty?.name;
  switch (it.kind) {
    case "burrow_in":
      return "Added to Burrow";
    case "burrow_out":
      return "Moved from Burrow";
    case "refund":
      return who ? `Returned from ${firstName(who)}` : "Returned to you";
    case "gift_bought":
      return who ? `${who} gift card` : "Gift card";
    default:
      return who ?? "BilbyPay";
  }
}

export function activitySubtitle(it: ActivityItem): string {
  const who = it.counterparty?.name ? firstName(it.counterparty.name) : "them";
  if (it.status === "waiting") return `Waiting for ${who} to open it`;
  if (it.status === "cancelled") return "Cancelled · back in your balance";
  if (it.status === "refunded") return "Not opened · back in your balance";
  if (it.status === "failed") return "Didn't go through";
  const when = new Date(it.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const label: Record<ActivityItem["kind"], string> = {
    sent: "Sent",
    received: "Received",
    gift_sent: "Gift sent",
    gift_received: "Gift received",
    gift_bought: "Bought",
    burrow_in: it.note === "Auto-save" ? "Auto-save" : "Burrow",
    burrow_out: "To your balance",
    refund: "Returned",
  };
  return `${label[it.kind]} · ${when}`;
}

export function activityAmount(it: ActivityItem): { text: string; color: string } {
  if (it.kind === "burrow_in" || it.kind === "burrow_out") return { text: usd(it.amount), color: colors.muted };
  if (INCOMING.has(it.kind)) return { text: `+${usd(it.amount)}`, color: colors.green };
  return { text: `−${usd(it.amount)}`, color: it.status === "cancelled" || it.status === "refunded" ? colors.muted : colors.ink };
}

const EMOJI: Partial<Record<ActivityItem["kind"], string>> = { burrow_in: "🌱", burrow_out: "🌱", gift_bought: "🎁", gift_sent: "🎁", gift_received: "🎁", refund: "↩︎" };

export function ActivityRow({ item }: { item: ActivityItem }) {
  const amount = activityAmount(item);
  return (
    <Row
      leading={<Avatar name={item.counterparty?.name ?? activityTitle(item)} emoji={EMOJI[item.kind]} />}
      title={activityTitle(item)}
      subtitle={activitySubtitle(item)}
      trailing={amount.text}
      trailingColor={amount.color}
      onPress={() => router.push(`/activity/${item.id}`)}
    />
  );
}
