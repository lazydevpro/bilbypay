import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api } from "../../api";
import { firstName, getRecipient, putDraft } from "../../flows/drafts";
import { displayTyped, isPositive, typedToBase, usd } from "../../money/amount";
import { formatE164 } from "../../phone/phone";
import { useLoad } from "../../state/useLoad";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { Keypad } from "../../ui/Keypad";
import { Notice } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

export default function Amount() {
  const { r } = useLocalSearchParams<{ r: string }>();
  const recipient = getRecipient(r);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const { data: balance } = useLoad(() => api.balance());

  if (!recipient) {
    return (
      <Screen>
        <Notice message="Pick who to send to first." action={{ label: "Choose someone", onPress: () => router.replace("/send") }} />
      </Screen>
    );
  }

  const amount = typedToBase(typed);
  const name = firstName(recipient.name);
  const total = balance ? BigInt(balance.balance) + BigInt(balance.burrow.amount) : null;
  const tooMuch = total !== null && BigInt(amount) > total;

  const next = () => {
    const draft = putDraft({
      request: { type: "send", params: { phone: recipient.e164, amount, ...(note.trim() ? { note: note.trim() } : {}) } },
      recipient,
    });
    router.push({ pathname: "/confirm", params: { draft } });
  };

  return (
    <Screen
      footer={
        <Button label={isPositive(amount) ? `Send ${usd(amount)}` : "Enter an amount"} disabled={!isPositive(amount) || tooMuch} onPress={next} />
      }
    >
      <View style={styles.who}>
        <Avatar name={recipient.name} size={48} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">{recipient.name}</Text>
          <Muted variant="small">
            {recipient.status === "registered" ? `On BilbyPay · ${formatE164(recipient.e164)}` : `${formatE164(recipient.e164)} · they'll get a link to open it`}
          </Muted>
        </View>
      </View>

      {recipient.recentlyChanged ? (
        <Notice
          tone="danger"
          title="This number changed hands recently"
          message={`${formatE164(recipient.e164)} moved to a new BilbyPay account in the last few days. Check with ${name} another way before sending.`}
        />
      ) : null}

      <View style={styles.amount}>
        <Text variant="hero" accessibilityLabel={`Amount ${displayTyped(typed)}`} adjustsFontSizeToFit numberOfLines={1}>
          {displayTyped(typed)}
        </Text>
        {balance ? (
          <Muted variant="small">
            Balance {usd(balance.balance)}
            {isPositive(balance.burrow.amount) ? ` · Burrow ${usd(balance.burrow.amount)}` : ""}
          </Muted>
        ) : null}
        {tooMuch ? <Text variant="small" color={colors.red}>That&apos;s more than you have.</Text> : null}
      </View>

      <TextInput
        accessibilityLabel="Add a note"
        value={note}
        onChangeText={setNote}
        placeholder={`What's it for? (optional)`}
        placeholderTextColor={colors.muted}
        style={styles.note}
        maxLength={80}
      />
      <Keypad value={typed} onChange={setTyped} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: space.md },
  amount: { alignItems: "center", gap: space.xs, paddingVertical: space.md },
  note: { minHeight: 48, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 16, color: colors.ink },
});
