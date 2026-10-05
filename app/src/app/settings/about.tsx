import Constants from "expo-constants";
import { StyleSheet, View } from "react-native";
import { BURROW_DISCLOSURE } from "../../copy/burrow";
import { Mascot } from "../../ui/Mascot";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

const SECTIONS = [
  {
    title: "How BilbyPay works",
    body: "Send dollars to a phone number. People with BilbyPay receive it in their balance. Others get a link, and the money waits for them. If they don't open it in time, it comes back to you.",
  },
  {
    title: "Your number finds you, Face ID protects you",
    body: "Your phone number is only used so friends can find you. Money only moves when you confirm with Face ID or your fingerprint. A text message code can never move your money.",
  },
  {
    title: "No fees to send",
    body: "Sending money is free. Gift cards show one price that includes a small service fee, if any.",
  },
];

export default function About() {
  return (
    <Screen>
      <View style={styles.signature}>
        <Mascot size={56} mood="idle" active={false} accessibilityLabel="Bilby, the BilbyPay mascot" />
        <View style={styles.signatureWords}>
          <Text variant="heading">bilbypay</Text>
          <Muted variant="small">A little joy. Every payment.</Muted>
        </View>
      </View>
      {SECTIONS.map((s) => (
        <View key={s.title} style={{ gap: space.xs }}>
          <Text variant="heading">{s.title}</Text>
          <Muted>{s.body}</Muted>
        </View>
      ))}
      <Text variant="title" style={{ marginTop: space.md }}>
        Burrow
      </Text>
      {BURROW_DISCLOSURE.map((s) => (
        <View key={s.title} style={{ gap: space.xs }}>
          <Text variant="heading">{s.title}</Text>
          <Muted>{s.body}</Muted>
        </View>
      ))}
      <Muted variant="small">BilbyPay {Constants.expoConfig?.version ?? ""}</Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  signature: { flexDirection: "row", alignItems: "center", gap: space.md, borderBottomWidth: 1, borderColor: colors.line, paddingBottom: space.lg },
  signatureWords: { flex: 1, gap: space.xs },
});
