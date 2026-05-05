-- Create per-service databases (ignore if already exists)
SELECT 'CREATE DATABASE registry' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'registry')\gexec
SELECT 'CREATE DATABASE runtime_broker' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'runtime_broker')\gexec
SELECT 'CREATE DATABASE approvals' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'approvals')\gexec
SELECT 'CREATE DATABASE packagehub' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'packagehub')\gexec
SELECT 'CREATE DATABASE packages' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'packages')\gexec
SELECT 'CREATE DATABASE mcp_gateway' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mcp_gateway')\gexec
SELECT 'CREATE DATABASE urule_state' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'urule_state')\gexec
SELECT 'CREATE DATABASE channel_router' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'channel_router')\gexec
SELECT 'CREATE DATABASE keycloak' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
SELECT 'CREATE DATABASE openfga' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'openfga')\gexec
SELECT 'CREATE DATABASE temporal' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal')\gexec
SELECT 'CREATE DATABASE temporal_visibility' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal_visibility')\gexec
