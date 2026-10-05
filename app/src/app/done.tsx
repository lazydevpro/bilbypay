import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { Share, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { safeMessage } from "../api/errors";
import { getOutcome, shareMessage } from "../flows/drafts";
import { usd, usdShort } from "../money/amount";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Line } from "../ui/Card";
import { Mascot } from "../ui/Mascot";
import { Icon } from "../ui/Icon";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

/** Reflect the server result. A link ready to share is still waiting for its recipient. */
export default function Done() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const outcome = getOutcome(id);
  const shared = useRef(false);
  const { refreshProfile } = useSession();

  const draft = outcome?.draft;
  const result = outcome?.result;
  const type = draft?.request.type;
  const who = draft?.recipient?.name ?? "Your recipient";
  const amount = draft && "amount" in draft.request.params ? draft.request.params.amount : result?.receipt?.amount;
  const isGift = type === "gift_send";

  const share = async () => {
    if (!result?.claimLink) return;
    const message = shareMessage({ kind: isGift ? "gift" : "money", amount: usdShort(amount ?? "0"), link: result.claimLink });
    await Share.share({ message, url: result.claimLink }).catch(() => {});
  };

  useEffect(() => {
    if (type === "burrow_autosave") void refreshProfile().catch(() => {});
  }, [type, refreshProfile]);

  useEffect(() => {
    if (result?.claimLink && !shared.current) {
      shared.current = true;
      const t = setTimeout(() => void share(), 450);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.claimLink]);

  if (!outcome || !draft || !result) {
    return (
      <Screen footer={<Button label="Done" onPress={() => router.dismissTo("/(tabs)")} />}>
        <Mascot size={180} mood="reassuring" />
        <Text variant="title">Payment details unavailable</Text>
        <Muted>Check Activity for the latest status.</Muted>
      </Screen>
    );
  }

  let title = "Done!";
  let body = "";
  switch (draft.request.type) {
    case "send":
      title = result.status === "waiting" ? "Ready when they are" : "A little joy, delivered.";
      body =
        result.status === "waiting"
          ? `Share the link with ${who} to collect ${usd(amount)}. If they don't open it in time, it comes back to you.`
          : `${who} received ${usd(amount)}.`;
      break;
    case "gift_send":
      title = `Your gift for ${who} is ready`;
      body = `Send ${who} the link to open their ${draft.gift?.brandName ?? ""} gift card.`;
      break;
    case "gift_buy":
      title = "Your gift card is ready";
      body = "It's in your Gift cards tab.";
      break;
    case "cancel":
      title = "Cancelled";
      body = "The money is back in your balance.";
      break;
    case "burrow_add":
      title = `${usd(amount)} is in Burrow`;
      body = "You can request to move it back to your balance from Burrow.";
      break;
    case "burrow_withdraw":
      title = `${usd(amount)} is in your balance`;
      body = "Ready to spend.";
      break;
    case "burrow_autosave":
      title = draft.request.params.enabled ? "Auto-save is on" : "Auto-save is off";
      body = draft.request.params.enabled
        ? `We'll keep ${usd(draft.request.params.threshold)} in your balance and tuck the rest into Burrow.`
        : "Your money stays in your balance.";
      break;
  }

  const complete = result.status === "completed";
  const waiting = result.status === "waiting";
  const celebrate = complete && (type === "send" || type === "gift_send" || type === "gift_buy");
  const note = draft.request.type === "send" ? draft.request.params.note : draft.gift?.message;

  // Future server actions may also wait. Never turn a pending response into a success claim.
  if (waiting && type !== "send" && type !== "gift_send") {
    title = "Still in progress";
    body = "Check Activity for the latest update.";
  }
  if (result.status === "failed") {
    title = "That didn't go through";
    body = result.error ? safeMessage(result.error.message) : "Check Activity for the latest update before trying again.";
  } else if (!complete && !waiting) {
    title = "Checking the result";
    body = "Check Activity for the latest update before trying again.";
  }

  return (
    <Screen
      edges={["top", "bottom"]}
      footer={
        <>
          {result.claimLink ? <Button label="Share the link" onPress={share} /> : null}
          {result.giftCardId ? <Button label="View gift card" onPress={() => router.replace(`/card/${result.giftCardId}`)} /> : null}
          <Button variant={result.claimLink || result.giftCardId ? "ghost" : "primary"} label="Done" onPress={() => router.dismissTo("/(tabs)")} />
        </>
      }
    >
      <View style={styles.hero}>
        <View style={[styles.status, complete && styles.statusComplete]}>
          <Icon name={complete ? "check" : waiting ? "gift" : "close"} size={18} color={complete ? colors.green : colors.brown} />
          <Text variant="bodyStrong" color={complete ? colors.green : colors.brown}>
            {complete ? type === "send" ? "Payment complete" : "All set" : waiting ? result.claimLink ? "Ready to share" : "In progress" : "Payment update"}
          </Text>
        </View>
        <View style={[styles.resultStage, !celebrate && styles.quietStage]}>
          {celebrate ? <Svg width="100%" height="100%" viewBox="0 0 300 224" aria-hidden style={StyleSheet.absoluteFill}>
            <Path d="m51 54 12 16m170-24-10 17M35 117l20 3m193-6 17-7" stroke={colors.gold} strokeWidth="6" strokeLinecap="round" />
            <Path d="m66 155 7 10m158-9 8-8" stroke={colors.red} strokeWidth="4" strokeLinecap="round" />
            <Circle cx="93" cy="25" r="4" fill={colors.primary} opacity={0.55} />
            <Circle cx="259" cy="168" r="4" fill={colors.gold} />
            <Path d="m192 25 3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" fill={colors.gold} />
          </Svg> : null}
          <Mascot size={celebrate ? 224 : 166} mood={celebrate ? "success" : complete ? "idle" : waiting ? isGift ? "gift" : "receiving" : "reassuring"} interactive={false} />
        </View>
        <Text variant="display" style={styles.center}>
          {title}
        </Text>
        {body ? <Text variant={complete && type === "send" ? "heading" : "body"} style={styles.center}>{body}</Text> : null}
        {note ? <View style={styles.note}><Muted style={styles.center}>“{note}”</Muted></View> : null}
      </View>
      {result.receipt ? (
        <View style={styles.receipt}>
          <View style={styles.receiptHeader}>
            <Text variant="caption" color={colors.muted} style={styles.receiptTitle}>{complete ? "YOUR RECEIPT" : "PAYMENT DETAILS"}</Text>
            <Icon name={complete ? "check" : "activity"} size={18} color={complete ? colors.green : colors.muted} />
          </View>
          <Line label="Reference" value={result.receipt.reference} />
          <Line label="When" value={new Date(result.receipt.at).toLocaleString()} />
          <View style={styles.receiptTear} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  center: { textAlign: "center", maxWidth: "100%" },
  status: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.sand },
  statusComplete: { backgroundColor: colors.greenSoft },
  note: { paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.lg, backgroundColor: colors.sand },
  resultStage: { width: "100%", maxWidth: 300, height: 224, alignItems: "center", justifyContent: "center" },
  quietStage: { height: 166 },
  receipt: { padding: space.xl, paddingBottom: space.md, gap: space.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  receiptHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: space.sm },
  receiptTitle: { letterSpacing: 1.2 },
  receiptTear: { borderBottomColor: colors.sandDeep, borderBottomWidth: 2, borderStyle: "dashed", marginTop: space.sm },
});
