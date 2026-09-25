-- Our own user id. Provider identities point at it; nothing else stores a provider subject.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
) STRICT;

-- A provider identity is its issuer and subject together, never a bare `sub`.
CREATE TABLE identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject)
) STRICT;
CREATE INDEX identities_user ON identities (user_id);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE memberships (
  site_id TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, user_id)
) STRICT;
CREATE INDEX memberships_user ON memberships (user_id);

-- One ownership generation: a controller between two factory resets. History and access hang
-- off (device_id, epoch), never off device_id alone. A generation belongs to one site.
CREATE TABLE controller_generations (
  device_id TEXT NOT NULL CHECK (length(device_id) = 32 AND device_id NOT GLOB '*[^0-9a-f]*'),
  epoch INTEGER NOT NULL CHECK (epoch BETWEEN 1 AND 4294967295),
  site_id TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  linked_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, epoch)
) STRICT;
CREATE INDEX controller_generations_site ON controller_generations (site_id);
