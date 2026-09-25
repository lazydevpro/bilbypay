import { Share, StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { formatE164 } from "../phone/phone";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Muted, Text } from "../ui/Text";
import { Screen } from "../ui/Screen";
import { colors, space } from "../ui/theme";

/** Your number is all anyone needs. The code opens BilbyPay's Send screen with it filled in. */
export default function Receive() {
  const { profile } = useSession();
  if (!profile) return null;
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
      <Muted style={styles.center}>Friends can pay you with just your number</Muted>
      <Text variant="display" style={styles.center} selectable>
        {pretty}
      </Text>
      <Card style={styles.qr}>
        <View accessible accessibilityLabel={`Code for sending to ${pretty}`}>
          <QRCode value={link} size={220} color={colors.ink} backgroundColor={colors.surface} />
        </View>
        <Muted variant="small" style={styles.center}>
          Friends with BilbyPay can scan this with their camera.
        </Muted>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  qr: { alignItems: "center", gap: space.lg, paddingVertical: space.xl },
});
