-- Enable pg_trgm for trigram-based search on packages.name and packages.description.
-- Previously created via the retired init-packagehub-schema.sh; capturing it
-- as a Drizzle migration so fresh installs (db:migrate) get the extension too.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
