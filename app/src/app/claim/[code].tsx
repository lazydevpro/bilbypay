import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { api, isApiError } from "../../api";
import { safeMessage } from "../../api/errors";
import type { Brand, ClaimAcceptResponse } from "../../api/types";
import { UnlockCancelled } from "../../auth/unlock";
import { usd } from "../../money/amount";
import { matchesMasked } from "../../phone/phone";
import { useSession } from "../../state/session";
import { useLoad } from "../../state/useLoad";
import { BrandGrid } from "../../ui/BrandGrid";
import { Button } from "../../ui/Button";
import { GiftFace } from "../../ui/GiftDesign";
import { Icon } from "../../ui/Icon";
import { Mascot } from "../../ui/Mascot";
import { prefetchMascot } from "../../ui/mascot/assets";
import { ErrorNote, Notice } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

/** Someone sent you money or a gift: see it, prove it's your number, open it. */
export default function ClaimScreen() {
  const { code = "" } = useLocalSearchParams<{ code: string }>();
  const session = useSession();
  const { status, profile, freshVerification, setPendingClaim } = session;
  const { data: claim, error, loading, reload } = useLoad(() => api.claim(code), [code]);
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ClaimAcceptResponse | null>(null);
  const [acceptError, setAcceptError] = useState<unknown>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => { void prefetchMascot("running"); }, []);

  const needsBrand = claim?.kind === "gift" && !claim.gift?.brandId;
  const verification = freshVerification();
  const verified = !!(claim && verification && matchesMasked(verification.phone, claim.phoneMasked));

  // Remember the link so it survives onboarding (and an app restart in the middle of it).
  useEffect(() => {
    if (code && status !== "ready" && !accepted) setPendingClaim(code);
  }, [code, status, accepted, setPendingClaim]);

  useEffect(() => {
    if (needsBrand && !brands) {
      void api
        .catalog()
        .then((c) => setBrands(c.brands))
        .catch(() => setBrands([]));
    }
  }, [needsBrand, brands]);

  const verifyNumber = () => router.push({ pathname: "/phone", params: { purpose: "claim", code } });

  const open = async () => {
    if (!claim || opening) return;
    setAcceptError(null);
    if (status === "signedOut") return router.push("/welcome");
    if (status === "locked") return router.push("/unlock");
    if (status !== "ready" || !profile) return verifyNumber();
    const v = freshVerification();
    if (!v || !matchesMasked(v.phone, claim.phoneMasked)) return verifyNumber();
    if (needsBrand && !brandId) {
      setAcceptError({ userMessage: "Pick a gift card first." });
      return;
    }
    setOpening(true);
    try {
      if (v.phone !== profile.phone || (profile.phoneStatus && profile.phoneStatus !== "active")) {
        setPendingClaim(code);
        setAcceptError({ userMessage: "Link and verify this number in Your number before opening this payment. Your current account and balance stay separate." });
        router.push("/settings/phone");
        return;
      }
      const res = await api.acceptClaim(code, { phoneToken: v.phoneToken, ...(needsBrand && brandId ? { brandId } : {}) });
      if (res.status !== "completed") {
        setAcceptError({ userMessage: "We couldn't confirm this yet. Check Activity before trying again." });
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPendingClaim(null);
      setAccepted(res);
    } catch (e) {
      if (!(e instanceof UnlockCancelled)) setAcceptError(e);
    } finally {
      setOpening(false);
    }
  };

  const done = () => {
    setPendingClaim(null);
    router.replace("/");
  };

  if (loading && !claim) {
    return (
      <Screen>
        <Mascot size={180} mood="thinking" interactive={false} />
        <Muted style={styles.center}>Finding your little surprise…</Muted>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }

  if (!claim) {
    return (
      <Screen footer={<Button variant="secondary" label="Close" onPress={done} />}>
        <Mascot size={180} mood="reassuring" interactive={false} />
        <ErrorNote error={error} onRetry={reload} />
      </Screen>
    );
  }

  if (accepted) {
    const chosenBrand = brands?.find((b) => b.id === brandId);
    const brandName = claim.gift?.brandName ?? chosenBrand?.name;
    return (
      <Screen
        edges={["top", "bottom"]}
        footer={
          accepted.giftCardId ? (
            <>
              <Button label="See your gift card" onPress={() => router.replace(`/card/${accepted.giftCardId}`)} />
              <Button variant="ghost" label="Home" onPress={done} />
            </>
          ) : (
            <Button label="Go to my balance" onPress={done} />
          )
        }
      >
        <View style={styles.status}>
          <Icon name="check" color={colors.green} size={20} />
          <Text variant="bodyStrong" color={colors.green}>{accepted.giftCardId ? "Your gift is ready" : "Added to your balance"}</Text>
        </View>
        <Mascot size={244} mood={accepted.error ? "reassuring" : "success"} interactive={false} />
        <Text variant="display" style={styles.center}>
          {claim.kind === "gift" && accepted.giftCardId ? "A little joy, just for you." : `${usd(accepted.amount)} is yours!`}
        </Text>
        <Muted style={styles.center}>
          {claim.kind === "gift" && accepted.giftCardId
            ? `Your ${brandName ?? ""} gift card from ${claim.senderName} is ready to use.`
            : `It's in your balance, from ${claim.senderName}.`}
        </Muted>
        {claim.kind === "gift" && accepted.giftCardId ? <GiftFace design={claim.gift?.design} brandName={brandName} artworkUrl={claim.gift?.brandArtworkUrl ?? chosenBrand?.artworkUrl} logoUrl={claim.gift?.brandLogoUrl ?? chosenBrand?.logoUrl} amount={accepted.amount} message={claim.gift?.message} from={claim.senderName} companion={false} /> : null}
        {accepted.error ? <Notice tone="info" message={safeMessage(accepted.error.message, "We couldn't prepare the gift card, so the money was added to your balance instead.")} /> : null}
      </Screen>
    );
  }

  const closed = claim.status !== "waiting";
  const label =
    status !== "ready" ? (claim.kind === "gift" ? "Open your gift" : `Get your ${usd(claim.amount)}`) : verified ? "Open it" : `Verify ${claim.phoneMasked}`;

  return (
    <Screen footer={closed ? <Button variant="secondary" label="Close" onPress={done} /> : <Button label={label} busyLabel="Opening…" disabled={needsBrand && verified && !brandId} onPress={open} />}>
      <Text variant="display" style={styles.center}>
        {claim.kind === "gift" ? `${claim.senderName} sent you a little joy` : `${claim.senderName} sent you ${usd(claim.amount)}`}
      </Text>

      {claim.kind === "gift" && (opening || acceptError || closed) ? <Mascot size={140} mood={opening ? "running" : "reassuring"} interactive={false} /> : null}

      {claim.kind === "gift" ? (
        <GiftFace design={claim.gift?.design} brandName={claim.gift?.brandName} artworkUrl={claim.gift?.brandArtworkUrl} logoUrl={claim.gift?.brandLogoUrl} amount={claim.amount} message={claim.gift?.message} from={claim.senderName} companion={!opening && !acceptError && !closed} />
      ) : (
        <View style={styles.moneyLetter}>
          <Svg width="100%" height="200" viewBox="0 0 342 200" preserveAspectRatio="none" aria-hidden style={styles.envelope}>
            <Path d="M6 76 165 4q6-4 12 0l159 72v112q0 8-8 8H14q-8 0-8-8Z" fill={colors.apricot} />
            <Path d="m6 80 149 96q16 10 32 0l149-96" fill={colors.sandDeep} />
            <Path d="m6 195 138-88q27-18 54 0l138 88" fill={colors.apricot} />
          </Svg>
          <View style={styles.letterPaper}>
            <Muted variant="small">From {claim.senderName}</Muted>
            <Text variant="hero" style={styles.center} adjustsFontSizeToFit minimumFontScale={0.65} numberOfLines={1}>{usd(claim.amount)}</Text>
            {claim.note ? <Text style={styles.center}>“{claim.note}”</Text> : null}
            <View style={styles.letterRule} />
            <Muted variant="caption" style={styles.center}>For {claim.phoneMasked}</Muted>
          </View>
          <View style={styles.letterCompanion}>
            <Mascot size={108} mood={opening ? "running" : acceptError || closed ? "reassuring" : "receiving"} interactive={false} />
          </View>
        </View>
      )}

      {claim.status === "opened" ? <Notice tone="success" message="This has already been opened." /> : null}
      {claim.status === "returned" ? <Notice message={`This went back to ${claim.senderName}. Ask them to send it again.`} /> : null}

      {!closed ? (
        <Muted variant="small">
          Sent to {claim.phoneMasked}. Open it by {new Date(claim.expiresAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}, or it goes back to{" "}
          {claim.senderName}.
        </Muted>
      ) : null}

      {!closed && needsBrand && status === "ready" ? (
        <View style={{ gap: space.md }}>
          <Text variant="heading">Pick your gift card</Text>
          {brands ? <BrandGrid brands={brands} selected={brandId} onPick={(b) => setBrandId(b.id)} /> : <ActivityIndicator color={colors.brown} />}
        </View>
      ) : null}

      <ErrorNote error={acceptError} />
      {isApiError(acceptError) && (acceptError.code === "WRONG_PHONE" || acceptError.code === "OTP_EXPIRED") ? (
        <Button
          variant="secondary"
          label={acceptError.code === "OTP_EXPIRED" ? "Verify my number again" : "Verify a different number"}
          onPress={verifyNumber}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center", maxWidth: "100%" },
  moneyLetter: { width: "100%", paddingTop: space.xxxl, paddingBottom: space.xl, marginTop: space.sm },
  envelope: { position: "absolute", bottom: 0 },
  letterPaper: { alignItems: "center", gap: space.md, marginHorizontal: space.lg, padding: space.xl, paddingTop: space.xxl, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, transform: [{ rotate: "-2deg" }] },
  letterRule: { alignSelf: "stretch", borderTopWidth: 1, borderColor: colors.line, borderStyle: "dashed", marginTop: space.xs },
  letterCompanion: { position: "absolute", right: -space.sm, top: -space.md },
  status: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: colors.greenSoft, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
});
