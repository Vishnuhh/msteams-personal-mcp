-- v0.8.0: admin page. Who each connection belongs to (Teams display name) and which app made it.
ALTER TABLE users ADD COLUMN account_name TEXT;
ALTER TABLE users ADD COLUMN app_name TEXT;
