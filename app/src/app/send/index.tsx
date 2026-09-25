import { getLocales } from "expo-localization";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Linking, StyleSheet, TextInput, View } from "react-native";
import { api } from "../../api";
import { getGift, putDraft, putRecipient, type Recipient } from "../../flows/drafts";
import { askForContacts, type ContactEntry, contactsAccess, type ContactsAccess, loadContacts } from "../../phone/contacts";
import { formatE164, toE164 } from "../../phone/phone";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { ErrorNote, Notice } from "../../ui/Notice";
import { Row } from "../../ui/Row";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

const region = () => {
  try {
    return getLocales()[0]?.regionCode ?? "US";
  } catch {
    return "US";
  }
};

/** Who to send to: search contacts or type a number. `mode=gift` finishes a gift started in the catalog. */
export default function PickRecipient() {
  const params = useLocalSearchParams<{ mode?: "send" | "gift"; gift?: string; phone?: string }>();
  const mode = params.mode ?? "send";
  const gift = getGift(params.gift);
  const [query, setQuery] = useState(params.phone ?? "");
  const [access, setAccess] = useState<ContactsAccess | null>(null);
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const a = await contactsAccess();
      setAccess(a);
      if (a === "granted" || a === "limited") setContacts(await loadContacts().catch(() => []));
    })();
  }, []);

  const typed = toE164(query, region());
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    const digits = q.replace(/\D/g, "");
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits)));
  }, [contacts, query]);

  const allow = async () => {
    const a = await askForContacts();
    setAccess(a);
    if (a === "granted" || a === "limited") setContacts(await loadContacts().catch(() => []));
  };

  const pick = async (name: string | null, phone: string, key: string) => {
    if (picking) return;
    setPicking(key);
    setError(null);
    try {
      const { results } = await api.resolve([phone], region());
      const r = results[0];
      if (!r || r.status === "invalid" || !r.e164) {
        setError({ userMessage: "That number doesn't look right. Check it and try again." });
        return;
      }
      const recipient: Recipient = {
        name: r.displayName ?? name ?? formatE164(r.e164),
        phone,
        e164: r.e164,
        status: r.status,
        address: r.address,
        recentlyChanged: r.recentlyChanged,
      };
      if (mode === "gift" && gift) {
        const draft = putDraft({
          request: { type: "gift_send", params: { phone: r.e164, brandId: gift.brandId, amount: gift.amount, message: gift.message, design: gift.design } },
          recipient,
          gift,
        });
        router.push({ pathname: "/confirm", params: { draft } });
      } else {
        router.push({ pathname: "/send/amount", params: { r: putRecipient(recipient) } });
      }
    } catch (e) {
      setError(e);
    } finally {
      setPicking(null);
    }
  };

  const header = (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      {gift ? <Muted>Who's the {gift.brandName} gift card for?</Muted> : null}
      <TextInput
        accessibilityLabel="Name or phone number"
        value={query}
        onChangeText={setQuery}
        placeholder="Name or phone number"
        placeholderTextColor={colors.muted}
        style={styles.search}
        autoCorrect={false}
        autoFocus={access !== "granted"}
        returnKeyType="go"
        onSubmitEditing={() => typed && pick(null, typed, "typed")}
      />
      {typed ? (
        <Card>
          <Row leading={<Avatar name="#" />} title={`Send to ${formatE164(typed)}`} subtitle="Works even if they don't have BilbyPay" onPress={() => pick(null, typed, "typed")} />
        </Card>
      ) : null}
      <ErrorNote error={error} />
      {access === "undetermined" ? (
        <Card tone="sand">
          <Text variant="bodyStrong">Find friends from your contacts</Text>
          <Muted variant="small">We only check a number with BilbyPay when you pick someone. Your contacts are never uploaded.</Muted>
          <Button compact label="Allow contacts" onPress={allow} style={{ alignSelf: "flex-start" }} />
        </Card>
      ) : null}
      {access === "denied" ? (
        <Notice
          message="Contacts are off for BilbyPay. You can still type a number, or turn contacts on in Settings."
          action={{ label: "Open Settings", onPress: () => Linking.openSettings() }}
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.xl }}
      keyboardShouldPersistTaps="handled"
      data={filtered}
      keyExtractor={(c) => c.key}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <Row
          leading={<Avatar name={item.name} />}
          title={item.name}
          subtitle={`${item.label ? `${item.label} · ` : ""}${item.phone}`}
          trailing={picking === item.key ? "…" : undefined}
          onPress={() => pick(item.name, item.phone, item.key)}
        />
      )}
      ListEmptyComponent={
        (access === "granted" || access === "limited") && query ? <Muted>No contacts match. Type their full number above.</Muted> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  search: { minHeight: 52, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17, color: colors.ink },
});
