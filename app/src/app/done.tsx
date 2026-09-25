import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { Share, StyleSheet, View } from "react-native";
import { firstName, getOutcome, shareMessage } from "../flows/drafts";
import { usd, usdShort } from "../money/amount";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card, Line } from "../ui/Card";
import { Mascot } from "../ui/Mascot";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { space } from "../ui/theme";

/** Success, straight away. For invites and gifts, the share sheet opens by itself. */
export default function Done() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const outcome = getOutcome(id);
  const shared = useRef(false);
  const { refreshProfile } = useSession();

  const draft = outcome?.draft;
  const result = outcome?.result;
  const type = draft?.request.type;
  const who = draft?.recipient ? firstName(draft.recipient.name) : undefined;
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
      <Screen footer={<Button label="Done" onPress={() => router.navigate("/(tabs)")} />}>
        <Text variant="title">All done</Text>
      </Screen>
    );
  }

  let title = "Done!";
  let body = "";
  switch (draft.request.type) {
    case "send":
      title = result.status === "waiting" ? `${usd(amount)} is on its way` : `Sent ${usd(amount)} to ${who}`;
      body =
        result.status === "waiting"
          ? `Send ${who} the link so they can open it. If they don't open it in time, it comes back to you.`
          : `${who} has it now.`;
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
      body = "Move it back to your balance any time.";
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

  return (
    <Screen
      edges={["top", "bottom"]}
      footer={
        <>
          {result.claimLink ? <Button label="Share the link" onPress={share} /> : null}
          {result.giftCardId ? <Button label="View gift card" onPress={() => router.replace(`/card/${result.giftCardId}`)} /> : null}
          <Button variant={result.claimLink || result.giftCardId ? "ghost" : "primary"} label="Done" onPress={() => router.navigate("/(tabs)")} />
        </>
      }
    >
      <View style={styles.hero}>
        <Mascot size={180} />
        <Text variant="display" style={styles.center}>
          {title}
        </Text>
        {body ? <Muted style={styles.center}>{body}</Muted> : null}
      </View>
      {result.receipt ? (
        <Card>
          <Line label="Reference" value={result.receipt.reference} />
          <Line label="When" value={new Date(result.receipt.at).toLocaleString()} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: "center", gap: space.lg, paddingTop: space.xl },
  center: { textAlign: "center" },
});
