import { StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { useCompanionTime } from "../state/companion";
import type { CompanionPeriod, CompanionPlacement, CompanionScene, CompanionTime } from "../state/companionModel";
import { Mascot, type MascotMood } from "./Mascot";

/** Scenery is decoration; the approved character artwork stays in its own foreground layer. */
export function SceneArt({ scene, placement = "right", period = "morning", showMailbox = true }: { scene: CompanionScene; placement?: CompanionPlacement; period?: CompanionPeriod; showMailbox?: boolean }) {
  const night = scene === "night";
  const afternoon = period === "afternoon";
  return (
    <Svg width="100%" height="100%" viewBox="0 0 390 240" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <Rect width="390" height="240" fill={night ? "#263757" : scene === "nook" ? "#F9EDD8" : afternoon ? "#FFF0D9" : "#FFF8E9"} />
      {scene === "nook" ? <>
        <Rect x="244" y="18" width="125" height="145" rx="52" fill="#EDC5AA" />
        <Rect x="303" y="18" width="7" height="145" fill="#FFFBF1" />
        <Rect x="244" y="92" width="125" height="7" fill="#FFFBF1" />
        <Circle cx="332" cy="51" r="23" fill="#F7D991" />
        <Path d="M0 173 Q190 160 390 174 V240 H0Z" fill="#E8CEA8" />
        <Path d="M0 209H390M65 174L51 240M324 174L339 240" stroke="#D9BB93" strokeWidth="2" />
        <Ellipse cx="218" cy="217" rx="115" ry="20" fill="#F9F1DF" />
        <Ellipse cx="218" cy="217" rx="94" ry="12" fill="#F2C09B" />
        <Path d="M39 161Q25 98 52 53Q79 101 39 161" fill="#728B58" />
        <Path d="M48 153Q58 90 100 77Q102 130 48 153" fill="#93A86D" />
        <Path d="M48 163Q21 137 14 93Q47 109 48 163" fill="#ADC183" />
        <Path d="M23 155H73L65 192H31Z" fill="#D99468" />
        <Rect x="20" y="150" width="56" height="12" rx="4" fill="#EEB285" />
        <Path d="M95 177V82Q95 31 139 30" fill="none" stroke="#B8834D" strokeWidth="7" strokeLinecap="round" />
        <Path d="M114 31Q145 14 163 53L119 70Q108 52 114 31" fill="#F1B575" />
        <Ellipse cx="94" cy="182" rx="26" ry="6" fill="#B8834D" />
      </> : <>
        {night ? <>
          <Path d="M326 27A27 27 0 1 0 351 65A29 29 0 0 1 326 27" fill="#FBE3A3" />
          {[[45,33],[104,56],[191,24],[247,57],[368,103],[168,85]].map(([x,y],i)=><Path key={i} d={`M${x} ${y-4}v8M${x-4} ${y}h8`} stroke="#E7D6A9" strokeWidth="2" strokeLinecap="round" />)}
        </> : <>
          <Circle cx={afternoon ? 95 : 314} cy={afternoon ? 38 : 50} r="32" fill={afternoon ? "#F4C477" : "#FADD98"} />
          <Path d="M-20 72Q-5 49 15 65Q18 27 49 35Q72 38 74 58Q107 45 115 80H-20" fill="#E5F0F1" />
          <Path d="M330 99Q341 67 365 76Q382 59 404 77V117H330" fill="#E5F0F1" />
        </>}
        <Path d="M-30 196Q66 138 148 178Q247 121 426 183V240H-30Z" fill={night ? "#46576A" : "#E2E9C9"} />
        <Path d="M-30 234Q96 173 230 208Q326 169 420 204V240H-30Z" fill={night ? "#61715F" : "#CAD8AA"} />
        {showMailbox && placement !== "center" && <G transform={`translate(${placement === "left" ? 270 : 42} 101)`}>
          <Rect x="20" y="56" width="9" height="61" rx="3" fill="#C19364" />
          <Path d="M-2 17Q-2 0 18 0H52Q71 0 71 17V61H-2Z" fill="#E88764" />
          <Path d="M38 17Q38 0 55 0Q72 0 72 17V61H38Z" fill="#F8D2A5" />
          <Path d="M-2 21H36M1 12H35" stroke="#CF7253" strokeWidth="4" strokeLinecap="round" />
          <Path d="M55 26C44 15 44 37 55 42C66 37 66 15 55 26" fill="#DC7258" />
          <Rect x="31" y="62" width="49" height="5" rx="2" fill="#C19364" />
        </G>}
        {[18,116,342,368].map((x,i)=><G key={x} transform={`translate(${x} ${211+(i%2)*11})`}>
          <Path d="M0 16V-3M0 9Q-10 0-10 5Q-9 11 0 13M0 5Q10-4 10 1Q9 7 0 9" fill={night ? "#84936C" : "#94AA73"} stroke={night ? "#84936C" : "#94AA73"} strokeWidth="2" />
          <Circle cx="0" cy="-4" r="6" fill="#FFF9E8" /><Circle cx="0" cy="-4" r="2.5" fill="#EEC77C" />
        </G>)}
      </>}
    </Svg>
  );
}

export function BilbyScene({ scene: override, mood, height = 232, interactive = true, time, placement: explicitPlacement }: {
  scene?: CompanionScene;
  mood?: MascotMood;
  height?: number;
  interactive?: boolean;
  time?: CompanionTime;
  placement?: CompanionPlacement;
}) {
  const localTime = useCompanionTime(!time && !override);
  const current = time ?? localTime;
  const selected = override ?? current.scene;
  const placement = explicitPlacement ?? (override ? selected === "nook" ? "center" : "right" : current.placement);
  const period = override ? selected === "meadow" ? "morning" : selected === "nook" ? "evening" : "night" : current.period;
  const resolvedMood = mood ?? (selected === "night" ? "sleepy" : "idle");
  const sleeping = resolvedMood === "sleepy";
  const size = sleeping ? Math.min(height * 1.12, 258) : Math.min(height * 0.98, 244);
  const position = placement === "left" ? { left: "4%" as const } : placement === "right" ? { right: "6%" as const } : { left: "50%" as const, transform: [{ translateX: -size / 2 }] };
  return <View style={[styles.scene, { height }]}>
    <View style={StyleSheet.absoluteFill} pointerEvents="none"><SceneArt scene={selected} placement={placement} period={period} showMailbox={!sleeping} /></View>
    <View style={[styles.character, position, sleeping && styles.sleeping]}><Mascot size={size} mood={resolvedMood} interactive={interactive} /></View>
  </View>;
}

const styles = StyleSheet.create({
  scene: { width: "100%", overflow: "hidden", borderRadius: 28 },
  character: { position: "absolute", bottom: 2 },
  sleeping: { bottom: -22 },
});
