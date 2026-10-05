import { StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import { Mascot, type MascotMood } from "./Mascot";
import { Text } from "./Text";
import { colors } from "./theme";

/** Entering the app has its own setting; the everyday home scene belongs on Home. */
export function EntryScene({ resting = false, mood, interactive = false }: { resting?: boolean; mood: MascotMood; interactive?: boolean }) {
  const sleeping = resting && mood === "sleepy";
  const size = sleeping ? 252 : resting ? 218 : 232;
  return <View style={[styles.stage, resting && styles.resting]}>
    <View style={styles.environment} pointerEvents="none"><Svg width="100%" height="100%" viewBox="0 0 350 260" aria-hidden>
      {resting ? <>
        <Circle cx="176" cy="122" r="104" fill="#E6EAF3" />
        <Path d="M260 31A27 27 0 1 0 285 68A31 31 0 0 1 260 31" fill="#E9C779" />
        <Path d="M75 70v10M70 75h10M300 117v8M296 121h8M105 25v8M101 29h8" stroke="#A2B5D2" strokeWidth="3" strokeLinecap="round" />
        <Ellipse cx="177" cy="237" rx="107" ry="12" fill="#DCD6CF" />
      </> : <>
        <Path d="M77 226V105A98 98 0 0 1 273 105V226" fill="#E8D2AD" />
        <Path d="M92 226V106A83 83 0 0 1 258 106V226" fill="#D7E2C5" />
        <Path d="M96 226V108A79 79 0 0 1 199 32L186 226Z" fill="#F3AD82" />
        <Path d="M109 205V112Q111 60 173 50L166 205Z" fill="none" stroke="#D98A62" strokeWidth="3" />
        <Circle cx="165" cy="149" r="5" fill="#B96A4D" />
        <Ellipse cx="181" cy="238" rx="117" ry="16" fill="#E1C59F" />
        <Ellipse cx="181" cy="236" rx="96" ry="10" fill="#F7E0B8" />
        <Path d="M42 213Q18 183 28 159Q56 171 49 213M51 210Q47 173 74 170Q81 191 51 210" fill="#8EAA79" />
        <Path d="M31 207H68L62 241H37Z" fill="#D99371" />
        <Rect x="29" y="204" width="42" height="9" rx="3" fill="#EBAD89" />
        <Path d="M290 104v14M283 111h14M308 166v10M303 171h10" stroke="#E3BC68" strokeWidth="3" strokeLinecap="round" />
      </>}
    </Svg></View>
    {!resting && mood === "welcome" ? <View style={styles.hello} accessibilityLabel="Bilby says hello">
      <Text variant="title" color={colors.primary}>Hello!</Text><View style={styles.speechTail} />
    </View> : null}
    <View style={[styles.character, { transform: [{ translateX: -size / 2 }] }, sleeping && styles.sleeping]}><Mascot size={size} mood={mood} interactive={interactive} /></View>
  </View>;
}

const styles = StyleSheet.create({
  stage: { width: "100%", height: 306, position: "relative" },
  resting: { height: 280 },
  environment: { position: "absolute", height: 260, bottom: 0, left: 0, right: 0 },
  character: { position: "absolute", bottom: 10, left: "50%" },
  sleeping: { bottom: -27 },
  hello: { position: "absolute", left: "8%", top: 4, zIndex: 2, borderRadius: 22, backgroundColor: colors.surface, paddingHorizontal: 18, paddingVertical: 8, borderWidth: 2, borderColor: "#DCE5EF", transform: [{ rotate: "-6deg" }] },
  speechTail: { position: "absolute", bottom: -8, right: 20, height: 14, width: 14, backgroundColor: colors.surface, borderRightWidth: 2, borderBottomWidth: 2, borderColor: "#DCE5EF", transform: [{ rotate: "45deg" }] },
});
