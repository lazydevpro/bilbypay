import { Share, StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { router } from "expo-router";
import { api } from "../api";
import { formatE164 } from "../phone/phone";
import { useSession } from "../state/session";
import { useLoad } from "../state/useLoad";
import { ErrorNote, Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Mascot } from "../ui/Mascot";
import { Muted, Text } from "../ui/Text";
import { Screen } from "../ui/Screen";
import { colors, radius, space } from "../ui/theme";

/** Your number is all anyone needs. The code opens BilbyPay's Send screen with it filled in. */
export default function Receive() {
  const { profile } = useSession();
  const { data: number, error, loading, reload } = useLoad(() => api.phoneStatus());
  if (!profile) return null;
  if (error || number?.status !== "active" || number.phone !== profile.phone) return <Screen>
    <Mascot size={160} mood={loading ? "thinking" : "reassuring"} />
    <Text variant="title">{loading ? "Checking your number…" : "Check your number first"}</Text>
    <ErrorNote error={error} onRetry={reload} />
    {!loading && !error ? <Notice message="Receiving by number is paused. Your existing money stays in this account." action={{ label: "Manage my number", onPress: () => router.push("/settings/phone") }} /> : null}
  </Screen>;
  const pretty = formatE164(profile.phone);
  const link = `bilbypay://send?phone=${encodeURIComponent(profile.phone)}`;

  return (
    <Screen
      footer={
        <Button
          label="Share my number"
          onPress={() => Share.share({ message: `Send me money on BilbyPay. My number is ${pretty}. Get the app at https://bilbypay.com` })}
        />
      }
    >
      <View style={styles.intro}><Text variant="display">Send a little my way.</Text><Muted>Your number is all a friend needs.</Muted></View>
      <View style={styles.ticket}>
        <View style={styles.identity}>
          <View style={{ flex: 1, gap: 4 }}><Text variant="caption" color={colors.primary}>PAY ME ON BILBYPAY</Text><Text variant="title">{profile.displayName}</Text></View>
          <View style={styles.stamp}><Mascot size={78} mood="receiving" /></View>
        </View>
        <View style={styles.qr}>
        <View accessible accessibilityLabel={`Code for sending to ${pretty}`}>
          <QRCode value={link} size={220} color={colors.ink} backgroundColor={colors.surface} />
        </View>
        <Text variant="heading" style={styles.center} selectable>{pretty}</Text>
        </View>
        <View style={styles.tear}><View style={styles.notchLeft} /><View style={styles.notchRight} /></View>
        <View style={styles.instructions}><Text variant="bodyStrong" style={styles.center}>Scan. Send. Make a day.</Text><Muted variant="small" style={styles.center}>Friends with BilbyPay can scan this with their camera.</Muted></View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.sm },
  center: { textAlign: "center" },
  ticket: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  identity: { flexDirection: "row", alignItems: "center", paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm, gap: space.sm },
  stamp: { width: 86, height: 90, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft, borderRadius: radius.md, transform: [{ rotate: "7deg" }] },
  qr: { alignItems: "center", gap: space.lg, paddingVertical: space.lg },
  tear: { borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.sandDeep, marginHorizontal: 16 },
  notchLeft: { position: "absolute", left: -25, top: -10, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.bg },
  notchRight: { position: "absolute", right: -25, top: -10, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.bg },
  instructions: { gap: space.xs, padding: space.lg },
});
