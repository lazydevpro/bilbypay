import { Contact, ContactField, getPermissionsAsync, requestPermissionsAsync } from "expo-contacts";

export type ContactEntry = { key: string; name: string; phone: string; label?: string };

export type ContactsAccess = "granted" | "limited" | "undetermined" | "denied";

export async function contactsAccess(): Promise<ContactsAccess> {
  try {
    const p = await getPermissionsAsync();
    if (p.granted) return p.accessPrivileges === "limited" ? "limited" : "granted";
    return p.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

export async function askForContacts(): Promise<ContactsAccess> {
  try {
    const p = await requestPermissionsAsync();
    if (p.granted) return p.accessPrivileges === "limited" ? "limited" : "granted";
    return "denied";
  } catch {
    return "denied";
  }
}

/** One row per phone number, sorted by name. Numbers never leave the phone until one is picked. */
export async function loadContacts(): Promise<ContactEntry[]> {
  const all = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES] as const);
  const out: ContactEntry[] = [];
  for (const c of all) {
    const name = c.fullName?.trim();
    if (!name) continue;
    for (const p of c.phones ?? []) {
      if (!p.number) continue;
      out.push({ key: `${c.id}:${p.number}`, name, phone: p.number, label: p.label });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
