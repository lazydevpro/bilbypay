import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "../../api";
import { putDraft } from "../../flows/drafts";
import { baseToTyped, displayTyped, isPositive, typedToBase, usd } from "../../money/amount";
import { useLoad } from "../../state/useLoad";
import { Button } from "../../ui/Button";
import { Keypad } from "../../ui/Keypad";
import { ErrorNote } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

/** Add to Burrow / Move to balance. Any amount, any time. */
export default function Move() {
  const { direction = "add" } = useLocalSearchParams<{ direction?: "add" | "withdraw" }>();
  const adding = direction === "add";
  const [typed, setTyped] = useState("");
  const { data: b, error, reload } = useLoad(() => api.balance());

  const amount = typedToBase(typed);
  const limit = b ? (adding ? b.balance : b.burrow.amount) : null;
  const busyLimit = b && !adding ? b.burrow.availableNow : null;
  const tooMuch = limit !== null && BigInt(amount) > BigInt(limit);

  const next = () => {
    const draft = putDraft({ request: adding ? { type: "burrow_add", params: { amount } } : { type: "burrow_withdraw", params: { amount } } });
    router.push({ pathname: "/confirm", params: { draft } });
  };

  return (
    <Screen
      footer={
        <Button
          label={isPositive(amount) ? (adding ? `Add ${usd(amount)} to Burrow` : `Move ${usd(amount)} to balance`) : "Enter an amount"}
          disabled={!isPositive(amount) || tooMuch}
          onPress={next}
        />
      }
    >
      <Text variant="title">{adding ? "Add to Burrow" : "Move to your balance"}</Text>
      <View style={styles.amount}>
        <Text variant="hero" adjustsFontSizeToFit numberOfLines={1}>
          {displayTyped(typed)}
        </Text>
        {limit !== null ? (
          <Pressable accessibilityRole="button" onPress={() => setTyped(baseToTyped(limit))} hitSlop={8}>
            <Text variant="small" color={colors.brown}>
              {adding ? `Balance ${usd(limit)}` : `In Burrow ${usd(limit)}`} · Use all
            </Text>
          </Pressable>
        ) : null}
        {tooMuch ? <Text variant="small" color={colors.red}>That&apos;s more than you have.</Text> : null}
        {busyLimit !== null && limit !== null && BigInt(busyLimit) < BigInt(limit) ? (
          <Muted variant="small">Right now you can move up to {usd(busyLimit)}. The rest is busy for a little while.</Muted>
        ) : null}
      </View>
      <ErrorNote error={error} onRetry={reload} />
      <Keypad value={typed} onChange={setTyped} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  amount: { alignItems: "center", gap: space.xs, paddingVertical: space.lg },
});
