import { errors } from "../errors";
import type { OtpProvider } from "./index";

export const TEST_OTP_CODE = "000000";

/**
 * Dev/test: no SMS is sent; the code is always 000000 for +1555 numbers (fictional range), or for
 * any number when OTP_TEST_ALL=1.
 */
export class TestOtpProvider implements OtpProvider {
  readonly name = "test";

  constructor(private readonly allNumbers: boolean) {}

  private allowed(e164: string) {
    return this.allNumbers || e164.startsWith("+1555");
  }

  async start(e164: string): Promise<void> {
    if (!this.allowed(e164)) throw errors.phoneInvalid("This number can't get codes on this test server. Use a +1 555 number.");
  }

  async check(e164: string, code: string): Promise<boolean> {
    return this.allowed(e164) && code === TEST_OTP_CODE;
  }
}
