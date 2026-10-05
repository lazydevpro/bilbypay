import type { ImageSourcePropType } from "react-native";

type AssetResolver = (source: ImageSourcePropType) => { uri: string } | null | undefined;

/** Expo web imports are URI objects; native imports are registered asset numbers. */
export function assetSourceUri(source: ImageSourcePropType, resolveRegistered?: AssetResolver): string | null {
  if (typeof source === "string") return source || null;
  if (typeof source === "number") return resolveRegistered?.(source)?.uri || null;
  if (!Array.isArray(source)) return source.uri || null;
  return null;
}

/** Object identity can change during Fast Refresh without the image URI changing. */
export function assetSourceKey(source: ImageSourcePropType, resolveRegistered?: AssetResolver): string {
  return assetSourceUri(source, resolveRegistered) ?? `asset:${JSON.stringify(source)}`;
}

/** Share pending downloads, but let the next route visit retry a failed prefetch. */
export function createAssetPrefetcher(prefetch: (uri: string) => Promise<boolean>) {
  const requests = new Map<string, Promise<boolean>>();
  return (uri: string): Promise<boolean> => {
    const existing = requests.get(uri);
    if (existing) return existing;
    const request = Promise.resolve().then(() => prefetch(uri)).then((loaded) => {
      if (!loaded) requests.delete(uri);
      return loaded;
    }, () => {
      requests.delete(uri);
      return false;
    });
    requests.set(uri, request);
    return request;
  };
}
