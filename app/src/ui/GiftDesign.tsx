import { StyleSheet, View } from "react-native";
import { usd } from "../money/amount";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

export const DESIGNS = [
  { id: "thanks", label: "Thank you", emoji: "🙏", bg: colors.goldSoft },
  { id: "birthday", label: "Happy birthday", emoji: "🎂", bg: colors.redSoft },
  { id: "love", label: "Sending love", emoji: "💛", bg: colors.blueSoft },
  { id: "congrats", label: "Congrats", emoji: "🎉", bg: colors.greenSoft },
] as const;

export const designFor = (id?: string) => DESIGNS.find((d) => d.id === id) ?? DESIGNS[0];

/** The card face a recipient sees: design, brand and amount, and the sender's message. */
export function GiftFace({ design, brandName, amount, message, from }: { design?: string; brandName?: string; amount: string; message?: string; from?: string }) {
  const d = designFor(design);
  return (
    <View style={[styles.face, { backgroundColor: d.bg }]}>
      <Text style={styles.emoji}>{d.emoji}</Text>
      <Text variant="heading">{d.label}</Text>
      <Text variant="display">{usd(amount)}</Text>
      <Text variant="bodyStrong" color={colors.brown}>
        {brandName ?? "Gift card of your choice"}
      </Text>
      {message ? <Text style={{ fontStyle: "italic" }}>“{message}”</Text> : null}
      {from ? (
        <Text variant="small" color={colors.muted}>
          From {from}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  face: { borderRadius: radius.xl, padding: space.xl, gap: space.sm, alignItems: "center" },
  emoji: { fontSize: 48 },
});
