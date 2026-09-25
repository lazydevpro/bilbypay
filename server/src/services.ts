import { AccountService } from "./accounts";
import { ActionService } from "./actions";
import { ActivityRepo } from "./activity";
import { Tokens } from "./auth";
import { BalanceService } from "./burrow";
import { ChainService } from "./chain";
import { ClaimService } from "./claims";
import type { Config } from "./config";
import { type Db, openDb } from "./db";
import { createGiftProvider } from "./giftcards/providers";
import { GiftCardService } from "./giftcards/service";
import type { GiftCardProvider } from "./giftcards/types";
import { Keeper } from "./keeper";
import { createOtpProvider, type OtpProvider } from "./otp";
import { Senders, type TxSender } from "./relayer";
import { Treasury } from "./treasury";
import { KeyedMutex } from "./util";
import { Verifier } from "./verifier";

export type Services = {
  config: Config;
  db: Db;
  chain: ChainService;
  relayer: TxSender;
  keeperSender: TxSender;
  verifier: Verifier;
  treasury: Treasury;
  tokens: Tokens;
  otp: OtpProvider;
  accounts: AccountService;
  activity: ActivityRepo;
  gifts: GiftCardService;
  claims: ClaimService;
  keeper: Keeper;
  actions: ActionService;
  balances: BalanceService;
};

export function createServices(config: Config, overrides: { db?: Db; giftProvider?: GiftCardProvider; otp?: OtpProvider } = {}): Services {
  const db = overrides.db ?? openDb(config.databasePath);
  const chain = new ChainService(config);
  const senders = new Senders(chain);
  const relayer = senders.forKey(config.keys.relayer);
  const keeperSender = senders.forKey(config.keys.keeper);
  const verifier = new Verifier(config.keys.verifier, config.deployment);
  const treasury = new Treasury(config.keys.treasury, chain, relayer);
  const tokens = new Tokens(config.tokenSecret);
  const otp = overrides.otp ?? createOtpProvider(config.otp);
  const userLocks = new KeyedMutex();
  const accounts = new AccountService(db, config, chain, verifier, relayer, tokens);
  const activity = new ActivityRepo(db, chain, config.publicBaseUrl);
  const gifts = new GiftCardService(db, overrides.giftProvider ?? createGiftProvider(config), treasury, activity, config.giftCodeKey);
  const claims = new ClaimService(db, config, chain, verifier, relayer, accounts, activity, gifts, treasury);
  const keeper = new Keeper(db, config, chain, keeperSender, accounts, activity, claims, gifts, userLocks);
  const actions = new ActionService({ db, config, chain, relayer, accounts, activity, claims, gifts, treasury, keeper, userLocks });
  keeper.hasOpenAction = (user) => actions.hasOpenAction(user);
  const balances = new BalanceService(config, chain, accounts, claims);
  return { config, db, chain, relayer, keeperSender, verifier, treasury, tokens, otp, accounts, activity, gifts, claims, keeper, actions, balances };
}
