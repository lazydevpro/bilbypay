import { router } from "expo-router";
import { Alert, StyleSheet, View } from "react-native";
import { IS_MOCK } from "../../config";
import { formatE164 } from "../../phone/phone";
import { useSession } from "../../state/session";
import { Avatar } from "../../ui/Avatar";
import { Card } from "../../ui/Card";
import { Notice } from "../../ui/Notice";
import { Row } from "../../ui/Row";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { space } from "../../ui/theme";

export default function Settings() {
  const { profile, logOut } = useSession();

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
        <Row title="Change number" subtitle="Move BilbyPay to a new phone number" onPress={() => router.push({ pathname: "/phone", params: { purpose: "change" } })} />
        <Row title="Burrow" subtitle="Auto-save and your Burrow money" onPress={() => router.push("/burrow")} />
        <Row title="Add money" subtitle="From an account you have elsewhere" onPress={() => router.push("/topup")} />
        <Row title="About & disclosures" subtitle="How BilbyPay and Burrow work" onPress={() => router.push("/settings/about")} />
        {__DEV__ ? <Row title="Developer tools" subtitle="Phase 0 passkey check" onPress={() => router.push("/dev/spike")} /> : null}
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
});
