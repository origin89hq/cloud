import type { Controller, LinkControllerRequest, Role, Site } from "@origin89/cloud";
import type { AccessClaims } from "./auth.ts";

declare const brand: unique symbol;
/** Our own user ID. Never a provider subject. */
export type UserId = string & { readonly [brand]: "UserId" };

export type LinkOutcome =
  | { kind: "linked"; controller: Controller }
  /** This site already holds the generation; the stored link is returned unchanged. */
  | { kind: "already_linked"; controller: Controller }
  | { kind: "not_found" }
  | { kind: "generation_linked" }
  | { kind: "stale_epoch" };

interface GenerationRow {
  device_id: string;
  epoch: number;
  site_id: string;
  name: string;
  linked_at: number;
}

interface SiteRow {
  id: string;
  name: string;
  created_at: number;
  role: Role;
}

const controller = (row: GenerationRow): Controller => ({
  deviceId: row.device_id,
  epoch: row.epoch,
  name: row.name,
  linkedAt: new Date(row.linked_at).toISOString(),
});

export class Store {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The user a provider identity maps to, if any. */
  async findUser(identity: Pick<AccessClaims, "issuer" | "subject">): Promise<UserId | null> {
    const row = await this.db
      .prepare("SELECT user_id FROM identities WHERE issuer = ? AND subject = ?")
      .bind(identity.issuer, identity.subject)
      .first<{ user_id: string }>();
    return row ? (row.user_id as UserId) : null;
  }

  /** The user a provider identity maps to, created on first sight. Safe under concurrent calls. */
  async resolveUser(identity: Pick<AccessClaims, "issuer" | "subject">): Promise<UserId> {
    const existing = await this.findUser(identity);
    if (existing) return existing;
    const id = crypto.randomUUID();
    const at = this.now().getTime();
    // If another request created the identity first, the insert is ignored, the user row is
    // removed again, and the select returns the winner.
    await this.db.batch([
      this.db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?)").bind(id, at),
      this.db
        .prepare(
          "INSERT INTO identities (issuer, subject, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(identity.issuer, identity.subject, id, at),
      this.db
        .prepare(
          "DELETE FROM users WHERE id = ? AND NOT EXISTS (SELECT 1 FROM identities WHERE user_id = ?)",
        )
        .bind(id, id),
    ]);
    const resolved = await this.findUser(identity);
    if (!resolved) throw new Error("identity missing after insert");
    return resolved;
  }

  async createSite(user: UserId, name: string): Promise<Site> {
    const id = crypto.randomUUID();
    const at = this.now().getTime();
    await this.db.batch([
      this.db
        .prepare("INSERT INTO sites (id, name, created_at) VALUES (?, ?, ?)")
        .bind(id, name, at),
      this.db
        .prepare(
          "INSERT INTO memberships (site_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
        )
        .bind(id, user, at),
    ]);
    return { id, name, role: "owner", createdAt: new Date(at).toISOString(), controllers: [] };
  }

  async listSites(user: UserId): Promise<Site[]> {
    const [sites, generations] = await Promise.all([
      this.db
        .prepare(
          `SELECT s.id, s.name, s.created_at, m.role FROM memberships m
           JOIN sites s ON s.id = m.site_id WHERE m.user_id = ? ORDER BY s.created_at, s.id`,
        )
        .bind(user)
        .all<SiteRow>(),
      this.db
        .prepare(
          `SELECT g.device_id, g.epoch, g.site_id, g.name, g.linked_at FROM controller_generations g
           JOIN memberships m ON m.site_id = g.site_id WHERE m.user_id = ?
           ORDER BY g.linked_at, g.device_id, g.epoch`,
        )
        .bind(user)
        .all<GenerationRow>(),
    ]);
    const bySite = new Map<string, Controller[]>();
    for (const row of generations.results) {
      const list = bySite.get(row.site_id) ?? [];
      list.push(controller(row));
      bySite.set(row.site_id, list);
    }
    return sites.results.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      createdAt: new Date(row.created_at).toISOString(),
      controllers: bySite.get(row.id) ?? [],
    }));
  }

  /**
   * Links one ownership generation to a site the user owns. A generation belongs to one site,
   * and an epoch older than one this site already holds for the device is refused: it
   * describes a controller that has since been reset. A newer epoch on another site does not
   * block the link, because the cloud cannot yet check who holds any generation (cloud#3).
   */
  async linkController(
    user: UserId,
    siteId: string,
    link: LinkControllerRequest,
  ): Promise<LinkOutcome> {
    const at = this.now().getTime();
    // The insert only happens when the caller owns the site and the site holds no newer epoch,
    // so a concurrent link can never produce two sites for one generation or a stale generation
    // on one site.
    const inserted = await this.db
      .prepare(
        `INSERT INTO controller_generations (device_id, epoch, site_id, name, linked_by, linked_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6
           WHERE EXISTS (SELECT 1 FROM memberships WHERE site_id = ?3 AND user_id = ?5 AND role = 'owner')
             AND NOT EXISTS (SELECT 1 FROM controller_generations WHERE device_id = ?1 AND site_id = ?3 AND epoch > ?2)
           ON CONFLICT DO NOTHING`,
      )
      .bind(link.deviceId, link.epoch, siteId, link.name, user, at)
      .run();
    if (inserted.meta.changes === 1)
      return {
        kind: "linked",
        controller: controller({
          device_id: link.deviceId,
          epoch: link.epoch,
          site_id: siteId,
          name: link.name,
          linked_at: at,
        }),
      };
    const owner = await this.db
      .prepare("SELECT 1 FROM memberships WHERE site_id = ? AND user_id = ? AND role = 'owner'")
      .bind(siteId, user)
      .first();
    if (!owner) return { kind: "not_found" };
    const existing = await this.db
      .prepare(
        "SELECT device_id, epoch, site_id, name, linked_at FROM controller_generations WHERE device_id = ? AND epoch = ?",
      )
      .bind(link.deviceId, link.epoch)
      .first<GenerationRow>();
    if (existing?.site_id === siteId)
      return { kind: "already_linked", controller: controller(existing) };
    if (existing) return { kind: "generation_linked" };
    return { kind: "stale_epoch" };
  }

  /**
   * Removes the user, their identities and memberships in one transaction. Sites left with no
   * member are deleted with their controller links. Controller enrolments are untouched: the
   * cloud never held them.
   */
  async deleteUser(user: UserId): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `DELETE FROM sites WHERE id IN (SELECT site_id FROM memberships WHERE user_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.site_id = sites.id AND m.user_id != ?1)`,
        )
        .bind(user),
      this.db.prepare("DELETE FROM users WHERE id = ?").bind(user),
    ]);
  }
}
