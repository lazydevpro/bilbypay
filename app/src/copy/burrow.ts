/** Burrow copy in one place (spec §4b: variable rate, can go down, not a bank product). */

export const rateLine = (ratePercent: number) => `Earning about ${ratePercent.toFixed(1)}% a year. The rate changes over time.`;

export const BURROW_DISCLOSURE: Array<{ title: string; body: string }> = [
  {
    title: "Your money, any time",
    body: "Burrow is a place to park dollars you aren't using. Move any amount back to your balance whenever you like. No lock-in and no penalty.",
  },
  {
    title: "The rate changes",
    body: "What Burrow earns is variable. It can go up or down, and it isn't promised. We show it as “about N% a year” and what you've earned so far.",
  },
  {
    title: "What it isn't",
    body: "Burrow is not a bank account and is not insured. BilbyPay lends your Burrow dollars through a third-party lending service run by software, which carries risk: in rare cases money could be delayed or lost.",
  },
  {
    title: "Sometimes busy",
    body: "If lots of people move money out at once, some Burrow money can be busy for a while. We'll tell you how much you can move right now, before you confirm.",
  },
];
