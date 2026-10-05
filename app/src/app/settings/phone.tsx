import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { api, messageFor } from "../../api";
import type { PhoneStatus } from "../../api/types";
import { UnlockCancelled, withUnlockedSigner } from "../../auth/unlock";
import { CHAIN_ID } from "../../config";
import { formatE164 } from "../../phone/phone";
import { checkDirectoryConsent } from "../../signing/directory";
import { useSession } from "../../state/session";
import { Button } from "../../ui/Button";
import { Card, Line } from "../../ui/Card";
import { Mascot } from "../../ui/Mascot";
import { Notice } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

const dateLabel = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not available";
const titles: Record<PhoneStatus["status"], string> = {
  active: "Ready for your friends", expired: "Time to verify again", revoked: "Receiving by number is off",
  pending: "A number change is waiting", reassigned: "This number is no longer linked", unlinked: "Link a number to get started",
};

export default function PhoneSettings() {
  const { address, profile, refreshProfile } = useSession();
  const [state, setState] = useState<PhoneStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"revoke" | "cancelRecovery" | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setState(await api.phoneStatus()); setCheckedAt(Date.now()); }
    catch (e) { setError(messageFor(e)); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const manage = async (operation: "revoke" | "cancelRecovery") => {
    if (!address || !state?.phoneKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await api.preparePhoneAction(operation);
      if (prepared.revision !== state.revision) throw { userMessage: "These details changed. Refresh and check them again." };
      const typed = checkDirectoryConsent(prepared, { account: address, chainId: CHAIN_ID, operation, phoneKey: state.phoneKey });
      const signature = await withUnlockedSigner(address, signer => signer.signTypedData(typed));
      setState(await api.submitPhoneAction({ id: prepared.id, signature }));
      setConfirm(null);
      if (profile) await refreshProfile();
    } catch (e) { if (!(e instanceof UnlockCancelled)) setError(messageFor(e)); }
    finally { setBusy(false); }
  };
  const verify = () => router.push({ pathname: "/phone", params: { purpose: profile ? "renew" : "onboard", phone: state?.phone ?? "" } });
  const ownPending = state?.pending?.account.toLowerCase() === address?.toLowerCase();
  const canFinish = !!state?.pending && Date.parse(state.pending.availableAt) <= checkedAt;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.copy}><Text variant="title">Your number</Text><Muted>A familiar way for friends to find you.</Muted></View>
        <Mascot size={108} mood={busy ? "thinking" : "reassuring"} interactive={!busy} />
      </View>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {state ? <>
        <Card>
          <Text variant="heading">{titles[state.status]}</Text>
          {state.phone ? <Text variant="bodyStrong">{formatE164(state.phone)}</Text> : null}
          {state.status === "active" ? <><Muted>Friends can use this number to pay you.</Muted><Line label="Verify again by" value={dateLabel(state.validUntil)} /></> : null}
          {state.status === "expired" ? <Muted>Payments to this number are paused until you verify it again.</Muted> : null}
          {state.status === "revoked" ? <Muted>Friends cannot pay you using this number. Your existing balance and account access are unchanged.</Muted> : null}
          {state.status === "reassigned" ? <Muted>This number now belongs to another account. Your existing balance stays with this account.</Muted> : null}
          {state.status === "pending" ? <>
            <Muted>{ownPending ? "The waiting period protects the previous number holder. You will need a new text code to finish linking this number. It never gives access to their money." : "Someone requested to move this number to another account. Payments by number are paused. Cancel the request if you still use this number."}</Muted>
            <Line label="Can finish from" value={dateLabel(state.pending?.availableAt)} />
          </> : null}
        </Card>
        {confirm ? <Notice tone="warning" title={confirm === "revoke" ? "Stop receiving on this number?" : "Cancel this number change?"} message={confirm === "revoke" ? "Friends will need your new number after you link it. Existing payments may need the sender to send them again. Your balance remains in this account." : ownPending ? "Your request will be stopped. This number will stay with its current account. You can link a different number instead." : "The requested move will be stopped. Verify your number again if its current verification has expired."} /> : null}
        {confirm ? <>
          <Button label={confirm === "revoke" ? "Confirm stop receiving" : "Confirm cancellation"} disabled={busy} onPress={() => manage(confirm)} />
          <Button label="Keep things as they are" variant="ghost" disabled={busy} onPress={() => setConfirm(null)} />
        </> : <>
          {state.status === "active" || state.status === "expired" || state.status === "revoked" ? <Button label="Verify this number again" onPress={verify} /> : null}
          {state.status === "pending" && ownPending ? <Button label={canFinish ? "Verify and finish linking" : "Waiting period in progress"} disabled={!canFinish} onPress={verify} /> : null}
          {state.status === "pending" ? <Button label={ownPending ? "Cancel my number request" : "Cancel this number change"} onPress={() => setConfirm("cancelRecovery")} /> : null}
          {state.status === "active" || state.status === "expired" ? <Button variant="secondary" label="Stop receiving on this number" onPress={() => setConfirm("revoke")} /> : null}
          {["revoked", "reassigned", "unlinked"].includes(state.status) ? <Button label="Link a different number" variant="secondary" onPress={() => router.push({ pathname: "/phone", params: { purpose: "change" } })} /> : null}
          <Button variant="ghost" label="Refresh details" disabled={loading} onPress={refresh} />
        </>}
      </> : null}
      {error ? <Notice tone="danger" message={error} action={{ label: "Try again", onPress: refresh }} /> : null}
      <Muted variant="small">Your number helps people find you. Your account is protected separately by your device confirmation.</Muted>
    </Screen>
  );
}
const styles = StyleSheet.create({ header: { flexDirection: "row", alignItems: "center", gap: space.md }, copy: { flex: 1, gap: space.sm } });
