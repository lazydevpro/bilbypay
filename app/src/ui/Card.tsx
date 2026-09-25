import type { ReactNode } from "react";
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { colors, radius, shadow, space } from "./theme";

export function Card({ children, style, onPress, tone = "surface" }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: "surface" | "sand" }) {
  const bg = tone === "sand" ? colors.sand : colors.surface;
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: bg, opacity: pressed ? 0.9 : 1 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, { backgroundColor: bg }, style]}>{children}</View>;
}

export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="heading">{children}</Text>
      {action}
    </View>
  );
}

/** Label/value line, e.g. in the confirm sheet and receipts. */
export function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant="small" color={colors.muted} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text variant={strong ? "bodyStrong" : "body"} style={styles.lineValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md, ...shadow },
  section: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space.sm },
  line: { flexDirection: "row", justifyContent: "space-between", gap: space.lg, alignItems: "flex-start" },
  lineValue: { flexShrink: 1, textAlign: "right" },
});
