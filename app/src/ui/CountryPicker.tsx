import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { type Country, countries } from "../phone/phone";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

export function CountryButton({ country, onPress }: { country: Country; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Country: ${country.name}, ${country.dial}. Change`} onPress={onPress} style={styles.button}>
      <Text variant="heading">{country.flag}</Text>
      <Text variant="bodyStrong">{country.dial}</Text>
    </Pressable>
  );
}

export function CountryPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (c: Country) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? countries().filter((c) => c.name.toLowerCase().includes(needle) || c.dial.includes(needle) || c.code.toLowerCase() === needle)
      : countries();
  }, [q]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Text variant="heading">Choose your country</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
            <Icon name="close" color={colors.brown} />
          </Pressable>
        </View>
        <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={colors.muted} style={styles.search} autoCorrect={false} />
        <FlatList
          data={list}
          keyExtractor={(c) => c.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => onPick(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.sand }]}>
              <Text variant="heading">{item.flag}</Text>
              <Text style={{ flex: 1 }}>{item.name}</Text>
              <Text color={colors.muted}>{item.dial}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md, minHeight: 56, borderRadius: radius.md, backgroundColor: colors.surface },
  sheet: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: space.lg },
  search: { marginHorizontal: space.lg, marginBottom: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, fontSize: 16, color: colors.ink },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, minHeight: 52 },
});
