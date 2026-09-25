import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Share, StyleSheet } from "react-native";
import { api } from "../../api";
import { activityById, firstName, putDraft, rememberActivity, shareMessage } from "../../flows/drafts";
import { usd, usdShort } from "../../money/amount";
import { useLoad } from "../../state/useLoad";
import { activityAmount, activitySubtitle, activityTitle } from "../../ui/ActivityRow";
import { Button } from "../../ui/Button";
import { Card, Line } from "../../ui/Card";
import { ErrorNote, Notice } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { TechnicalDetails } from "../../ui/TechnicalDetails";
import { Muted, Text } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

const dateLong = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Receipt: amount, who, when, reference. Waiting items can be shared again or cancelled. */
export default function Receipt() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { data: item, error, loading, reload } = useLoad(async () => {
    const cached = activityById(id);
    if (cached) return cached;
    const page = await api.activity();
    rememberActivity(page.items);
    return page.items.find((i) => i.id === id) ?? null;
  }, [id]);

  if (loading && !item) return <ActivityIndicator color={colors.brown} style={{ marginTop: space.xxl }} />;
  if (!item) {
    return (
      <Screen>
        {error ? <ErrorNote error={error} onRetry={reload} /> : <Notice message="We couldn't find this payment. Pull down on Activity to refresh." />}
      </Screen>
    );
  }

  const amount = activityAmount(item);
  const who = item.counterparty?.name ? firstName(item.counterparty.name) : "them";
  const waiting = item.status === "waiting";
  const isGift = item.kind === "gift_sent";

  const shareAgain = () =>
    item.claimLink ? Share.share({ message: shareMessage({ kind: isGift ? "gift" : "money", amount: usdShort(item.amount), link: item.claimLink }), url: item.claimLink }) : undefined;

  const cancel = () => {
    const draft = putDraft({ request: { type: "cancel", params: { activityId: item.id } } });
    router.push({ pathname: "/confirm", params: { draft } });
  };

  return (
    <Screen
      footer={
        waiting ? (
          <>
            {item.claimLink ? <Button label="Share again" onPress={shareAgain} /> : null}
            {item.canCancel ? <Button variant="danger" label="Cancel and get it back" onPress={cancel} /> : null}
          </>
        ) : item.giftCardId && (item.kind === "gift_bought" || item.kind === "gift_received") ? (
          <Button label="View gift card" onPress={() => router.push(`/card/${item.giftCardId}`)} />
        ) : undefined
      }
    >
      <Text variant="hero" color={amount.color} style={styles.center}>
        {amount.text}
      </Text>
      <Text variant="heading" style={styles.center}>
        {activityTitle(item)}
      </Text>
      <Muted style={styles.center}>{activitySubtitle(item)}</Muted>

      {waiting ? (
        <Notice
          tone="info"
          title={`Waiting for ${who} to open it`}
          message={item.expiresAt ? `Returns to you on ${dateLong(item.expiresAt)} if not opened.` : "It comes back to you if it isn't opened in time."}
        />
      ) : null}

      <Card>
        {item.counterparty ? <Line label={item.kind.startsWith("sent") || item.kind === "gift_sent" ? "To" : "Who"} value={item.counterparty.name} /> : null}
        {item.counterparty?.phoneMasked ? <Line label="Number" value={item.counterparty.phoneMasked} /> : null}
        <Line label="Amount" value={usd(item.amount)} />
        {item.note ? <Line label="Note" value={item.note} /> : null}
        <Line label="When" value={new Date(item.receipt?.at ?? item.createdAt).toLocaleString()} />
        {item.receipt ? <Line label="Reference" value={item.receipt.reference} /> : null}
        <TechnicalDetails technical={item.receipt?.technical} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
});
