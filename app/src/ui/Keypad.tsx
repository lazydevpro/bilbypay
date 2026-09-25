import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, View } from "react-native";
import { type KeypadKey, pressKey } from "../money/amount";
import { Text } from "./Text";
import { colors, radius } from "./theme";

const ROWS: KeypadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

/** Dollar keypad. `value` is the typed string ("12.5"); see money/amount.ts for the rules. */
export function Keypad({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const press = (key: KeypadKey) => {
    const next = pressKey(value, key);
    if (next === value) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    else void Haptics.selectionAsync().catch(() => {});
    onChange(next);
  };
  return (
    <View style={styles.pad}>
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key === "back" ? "Delete" : key === "." ? "Decimal point" : key}
              onPress={() => press(key)}
              onLongPress={key === "back" ? () => onChange("") : undefined}
              style={({ pressed }) => [styles.key, pressed && { backgroundColor: colors.sand }]}
            >
              <Text variant="title" color={colors.brown}>
                {key === "back" ? "⌫" : key}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 6 },
  row: { flexDirection: "row", gap: 6 },
  key: { flex: 1, height: 60, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
