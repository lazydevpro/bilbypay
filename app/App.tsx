import { isMeraError } from "@category-labs/mera";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { isAddress } from "viem";
import { type Account, createAccount, RP_ID, signIn } from "./src/account";
import { CHAIN_ID, signTestPayment } from "./src/payment";

/**
 * Phase 0 spike screen (developer-only, not the product UI).
 * Proves: passkey → deterministic account on iOS/Android, same account after reinstall,
 * and a passkey-signed payment the relay script can submit.
 */
export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const note = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    const started = Date.now();
    try {
      await fn();
      note(`${label} ok (${Date.now() - started} ms)`);
    } catch (error) {
      const message = isMeraError(error) ? `${error.code}: ${error.message}` : String(error);
      note(`${label} failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>BilbyPay · Phase 0 spike</Text>
      <Text style={styles.muted}>rpId {RP_ID} · chain {CHAIN_ID}</Text>

      <View style={styles.card}>
        <TextInput style={styles.input} placeholder="Your name (shown in the passkey sheet)" value={name} onChangeText={setName} />
        <Button
          label="Create account (new passkey)"
          disabled={busy || !name.trim()}
          onPress={() => run("create", async () => setAccount(await createAccount(name.trim())))}
        />
        <Button label="Sign in with existing passkey" disabled={busy} onPress={() => run("sign in", async () => setAccount(await signIn()))} />
      </View>

      {account && (
        <View style={styles.card}>
          <Text style={styles.label}>Account</Text>
          <Text selectable style={styles.mono}>{account.address}</Text>
          <Text style={styles.muted}>Reinstall the app (or use another phone signed into the same Apple/Google account), tap "Sign in", and this must match.</Text>
          <Button label="Share account" disabled={busy} onPress={() => Share.share({ message: account.address })} />

          <Text style={[styles.label, { marginTop: 16 }]}>Sign a test payment</Text>
          <TextInput style={styles.input} placeholder="Recipient 0x…" autoCapitalize="none" value={to} onChangeText={setTo} />
          <TextInput style={styles.input} placeholder="Amount in USD" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Button
            label="Sign & share for relay"
            disabled={busy || !isAddress(to)}
            onPress={() =>
              run("sign payment", async () => {
                const signed = await signTestPayment(account, to as `0x${string}`, amount);
                await Share.share({ message: JSON.stringify(signed, null, 2) });
              })
            }
          />
        </View>
      )}

      {busy && <ActivityIndicator style={{ marginVertical: 12 }} />}
      {log.map((line, i) => (
        <Text key={i} style={styles.log}>{line}</Text>
      ))}
    </ScrollView>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, disabled && { opacity: 0.4 }]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 64, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
  muted: { color: "#666", fontSize: 13 },
  card: { backgroundColor: "#f4f1ec", borderRadius: 14, padding: 16, gap: 10 },
  label: { fontWeight: "600" },
  mono: { fontFamily: "Menlo", fontSize: 13 },
  input: { backgroundColor: "white", borderRadius: 10, padding: 12, fontSize: 15 },
  button: { backgroundColor: "#3b2f2a", borderRadius: 10, padding: 14, alignItems: "center" },
  buttonText: { color: "white", fontWeight: "600" },
  log: { fontFamily: "Menlo", fontSize: 11, color: "#444" },
});
