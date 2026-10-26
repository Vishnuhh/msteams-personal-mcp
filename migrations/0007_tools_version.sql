-- Which version of the tool list each connection's app last loaded (apps cache it when they connect).
-- NULL = loaded before this was tracked. Outdated connections get a one-line "refresh the connector" note.
ALTER TABLE users ADD COLUMN tools_version INTEGER;
