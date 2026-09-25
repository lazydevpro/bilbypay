import { Platform } from "react-native";

/** How we name the one confirmation step on this platform ("Confirm with Face ID"). */
export const BIOMETRIC = Platform.OS === "ios" ? "Face ID" : "your fingerprint";
export const CONFIRM_LABEL = `Confirm with ${BIOMETRIC}`;
