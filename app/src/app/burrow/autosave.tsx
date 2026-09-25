import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { putDraft } from "../../flows/drafts";
import { baseToTyped, displayTyped, isPositive, typedToBase, usd } from "../../money/amount";
import { useSession } from "../../state/session";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Keypad } from "../../ui/Keypad";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

/** "Keep $200 in my balance, tuck the rest away." One Face ID to turn on, one to turn off. */
export default function AutoSave() {
  const { profile } = useSession();
  const current = profile?.autoSave ?? { enabled: false, threshold: "0" };
  const [enabled, setEnabled] = useState(true);
  const [typed, setTyped] = useState(current.enabled ? baseToTyped(current.threshold) : "200");
  const threshold = typedToBase(typed);

  const unchanged = enabled === current.enabled && (!enabled || threshold === current.threshold);

  const save = () => {
    const draft = putDraft({ request: { type: "burrow_autosave", params: { enabled, threshold: enabled ? threshold : "0" } } });
    router.push({ pathname: "/confirm", params: { draft } });
  };

  return (
    <Screen footer={<Button label={enabled ? "Turn on auto-save" : "Turn off auto-save"} disabled={unchanged || (enabled && !isPositive(threshold))} onPress={save} />}>
      <Card style={styles.toggle}>
        <View style={{ flex: 1 }}>
          <Text variant="heading">Auto-save</Text>
          <Muted variant="small">When money arrives, anything above your amount goes into Burrow.</Muted>
        </View>
        <Switch
          accessibilityLabel="Auto-save"
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ true: colors.brown, false: colors.sandDeep }}
          thumbColor={colors.white}
        />
      </Card>

      {enabled ? (
        <>
          <Text variant="heading" style={{ textAlign: "center" }}>
            Keep {displayTyped(typed)} in my balance,{"\n"}tuck the rest away
          </Text>
          <Keypad value={typed} onChange={setTyped} />
        </>
      ) : (
        <Muted>
          {current.enabled ? `Auto-save is on at ${usd(current.threshold)}. Turning it off leaves your money where it is.` : "Auto-save is off."}
        </Muted>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", alignItems: "center", gap: space.md },
});
