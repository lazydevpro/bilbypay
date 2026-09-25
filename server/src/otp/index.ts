import type { Config } from "../config";
import { TestOtpProvider } from "./test";
import { TwilioVerifyProvider } from "./twilio";

export interface OtpProvider {
  readonly name: string;
  /** Sends a code to `e164`. Throws PHONE_INVALID if the number can't receive one. */
  start(e164: string): Promise<void>;
  /** True when `code` is the right one for `e164`. */
  check(e164: string, code: string): Promise<boolean>;
}

export function createOtpProvider(config: Config["otp"]): OtpProvider {
  if (config.provider === "twilio") return new TwilioVerifyProvider(config.twilio!);
  return new TestOtpProvider(config.testAll);
}
