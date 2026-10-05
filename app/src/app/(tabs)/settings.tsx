import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";
import { IS_MOCK } from "../../config";
import { formatE164 } from "../../phone/phone";
import { reloadCompanionPreferences, saveCompanionPreferences, useCompanionPreferences } from "../../state/companion";
import { useSession } from "../../state/session";
import { Avatar } from "../../ui/Avatar";
import { Card } from "../../ui/Card";
import { Notice } from "../../ui/Notice";
import { Row } from "../../ui/Row";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

export default function Settings() {
  const { profile, logOut } = useSession();
  const preferences = useCompanionPreferences();
  const [savingMotion, setSavingMotion] = useState(false);
  const [motionError, setMotionError] = useState<string | null>(null);

  const toggleMotion = async (motionEnabled: boolean) => {
    setSavingMotion(true);
    setMotionError(null);
    try { await saveCompanionPreferences({ motionEnabled }); }
    catch { setMotionError("We couldn't save your motion preference. Please try again."); }
    finally { setSavingMotion(false); }
  };

  const confirmLogOut = () =>
    Alert.alert("Log out of BilbyPay?", "Your money stays safe. Log back in any time with Face ID on this phone.", [
      { text: "Stay", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await logOut();
          router.replace("/welcome");
        },
      },
    ]);

  return (
    <Screen>
      <Card style={styles.profile}>
        <Avatar name={profile?.displayName ?? "?"} size={64} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">{profile?.displayName}</Text>
          <Muted>{profile ? formatE164(profile.phone) : ""}</Muted>
        </View>
      </Card>

      <Card>
        <Row title="Your number" subtitle="Verify, change, or stop receiving by number" onPress={() => router.push("/settings/phone")} />
        <Row title="Burrow" subtitle="Auto-save and your Burrow money" onPress={() => router.push("/burrow")} />
        <Row title="Add money" subtitle="Card preview or receive from a friend" onPress={() => router.push("/topup")} />
        <Row title="About & disclosures" subtitle="How BilbyPay and Burrow work" onPress={() => router.push("/settings/about")} />
      </Card>

      <Card>
        <View style={styles.motion}>
          <View style={styles.motionCopy}>
            <Text variant="bodyStrong">Animate Bilby</Text>
            <Muted variant="small">Gentle movement and little reactions. Your device’s reduced motion setting comes first.</Muted>
          </View>
          <Switch
            accessibilityLabel="Animate Bilby"
            value={preferences.motionEnabled}
            disabled={!preferences.hydrated || savingMotion}
            onValueChange={value => { void toggleMotion(value); }}
            trackColor={{ false: colors.line, true: colors.primary }}
            thumbColor={colors.white}
          />
        </View>
        {preferences.error ? <Notice tone="danger" message={preferences.error} action={{ label: "Try again", onPress: reloadCompanionPreferences }} /> : null}
        {motionError ? <Notice tone="danger" message={motionError} /> : null}
      </Card>

      {IS_MOCK ? <Notice message="Demo mode: nothing real moves." /> : null}

      <Card>
        <Row title="Log out" onPress={confirmLogOut} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: "row", alignItems: "center", gap: space.lg },
  motion: { flexDirection: "row", alignItems: "center", gap: space.md },
  motionCopy: { flex: 1, gap: space.xs },
});
