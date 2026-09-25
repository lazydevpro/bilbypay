import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from "react-native";
import { api } from "../../api";
import { usd } from "../../money/amount";
import { useLoad } from "../../state/useLoad";
import { BrandLogo } from "../../ui/Avatar";
import { Barcode } from "../../ui/Barcode";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Icon } from "../../ui/Icon";
import { ErrorNote } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

/** The card, rendered natively: brand, big code with one-tap copy, PIN, barcode, open in the brand's app. */
export default function CardView() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, reload } = useLoad(async () => {
    const [list, reveal] = await Promise.all([api.giftCards(), api.revealGiftCard(id)]);
    return { card: list.cards.find((c) => c.id === id) ?? null, reveal };
  }, [id]);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (what: string, value: string) => {
    await Clipboard.setStringAsync(value);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading && !data) {
    return (
      <Screen>
        <ActivityIndicator color={colors.brown} style={{ marginTop: space.xxl }} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <ErrorNote error={error} onRetry={reload} />
      </Screen>
    );
  }

  const { card, reveal } = data;
  const name = card?.brandName ?? "Gift card";

  return (
    <Screen footer={reveal.url ? <Button label={`Open in ${name}`} onPress={() => Linking.openURL(reveal.url!)} /> : undefined}>
      <View style={styles.face}>
        <BrandLogo name={name} uri={card?.logoUrl} size={64} />
        <Text variant="title" color={colors.white}>
          {name}
        </Text>
        {card ? (
          <Text variant="display" color={colors.white}>
            {usd(card.amount)}
          </Text>
        ) : null}
        {card?.from ? <Text color={colors.sand}>From {card.from}</Text> : null}
      </View>

      {reveal.code ? (
        <Card>
          <Muted variant="small">Card number</Muted>
          <Pressable accessibilityRole="button" accessibilityHint="Copies the card number" onPress={() => copy("code", reveal.code!)} style={styles.codeRow}>
            <Text variant="title" selectable style={styles.code}>
              {reveal.code}
            </Text>
            <Icon name={copied === "code" ? "check" : "copy"} color={copied === "code" ? colors.green : colors.brown} />
          </Pressable>
          {copied === "code" ? <Muted variant="small">Copied</Muted> : null}
          {reveal.pin ? (
            <>
              <Muted variant="small">PIN</Muted>
              <Pressable accessibilityRole="button" accessibilityHint="Copies the PIN" onPress={() => copy("pin", reveal.pin!)} style={styles.codeRow}>
                <Text variant="heading" selectable style={styles.code}>
                  {reveal.pin}
                </Text>
                <Icon name={copied === "pin" ? "check" : "copy"} color={copied === "pin" ? colors.green : colors.brown} />
              </Pressable>
            </>
          ) : null}
        </Card>
      ) : null}

      {reveal.barcode ? (
        <Card style={{ alignItems: "center" }}>
          <Muted variant="small">Show this at the checkout</Muted>
          <Barcode format={reveal.barcode.format} value={reveal.barcode.value} width={280} />
        </Card>
      ) : null}

      {reveal.instructions ? <Muted>{reveal.instructions}</Muted> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  face: { backgroundColor: colors.brown, borderRadius: radius.xl, padding: space.xl, gap: space.sm, alignItems: "flex-start" },
  codeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, minHeight: 48 },
  code: { flex: 1, fontVariant: ["tabular-nums"], letterSpacing: 1 },
});
