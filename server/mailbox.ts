// Read-only mailbox connection for importing Booking.com and Airbnb
// confirmation emails. Neither provider offers a guest-account API, so their
// emails are the reliable record of a reservation. The app password is stored
// only on the server, in a private file, and is never sent back to browsers.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
export type MailboxConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
};
export type ReservationEmail = {
  id: string;
  provider: "booking" | "airbnb";
  from: string;
  subject: string;
  date: string;
  text: string;
};
const senders = ["booking.com", "airbnb.com"];
export function mailbox(dataDir: string) {
  const dir = join(dataDir, "secrets");
  const file = join(dir, "mailbox.json");
  const read = (): MailboxConfig | null =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const client = (c: MailboxConfig) =>
    new ImapFlow({
      host: c.host,
      port: c.port,
      secure: true,
      auth: { user: c.user, pass: c.password },
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
    });
  async function verify(c: MailboxConfig) {
    const imap = client(c);
    await imap.connect();
    await imap.logout();
  }
  return {
    status() {
      const c = read();
      return c
        ? { configured: true, host: c.host, user: c.user }
        : { configured: false };
    },
    async save(c: MailboxConfig) {
      await verify(c);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
      chmodSync(file, 0o600);
    },
    remove() {
      rmSync(file, { force: true });
    },
    async scan(since: Date): Promise<ReservationEmail[]> {
      const c = read();
      if (!c) throw Error("Mailbox not connected");
      const imap = client(c);
      await imap.connect();
      try {
        // Gmail archives mail out of the inbox; search "All Mail" when present.
        const folders = await imap.list();
        const all = folders.find((f) => f.specialUse === "\\All");
        const lock = await imap.getMailboxLock(all?.path || "INBOX");
        try {
          const uids = new Set<number>();
          for (const from of senders) {
            const found = await imap.search({ from, since }, { uid: true });
            for (const uid of found || []) uids.add(uid);
          }
          const newest = [...uids].sort((a, b) => b - a).slice(0, 60);
          const result: ReservationEmail[] = [];
          if (!newest.length) return result;
          for await (const msg of imap.fetch(
            newest,
            { source: true },
            { uid: true },
          )) {
            if (!msg.source) continue;
            const mail = await simpleParser(msg.source);
            const from = mail.from?.value[0]?.address || "";
            const provider = from.toLowerCase().includes("airbnb")
              ? "airbnb"
              : "booking";
            const html =
              typeof mail.html === "string"
                ? mail.html
                    .replace(
                      /<(br|\/p|\/div|\/tr|\/td|\/h\d|\/li)[^>]*>/gi,
                      "\n",
                    )
                    .replace(/<style[\s\S]*?<\/style>/gi, "")
                    .replace(/<[^>]+>/g, " ")
                    .replace(/&nbsp;/g, " ")
                    .replace(/&amp;/g, "&")
                    .replace(/&#39;|&rsquo;/g, "'")
                    .replace(/&quot;/g, '"')
                : "";
            const text = (mail.text || html)
              .replace(/[ \t]+/g, " ")
              .replace(/\n\s*\n+/g, "\n")
              .slice(0, 30000);
            result.push({
              id: mail.messageId || `uid-${msg.uid}`,
              provider,
              from,
              subject: mail.subject || "",
              date: (mail.date || new Date()).toISOString(),
              text,
            });
          }
          return result.sort((a, b) => b.date.localeCompare(a.date));
        } finally {
          lock.release();
        }
      } finally {
        await imap.logout().catch(() => {});
      }
    },
  };
}
