SELECT format('ALTER DATABASE %I SET default_transaction_read_only = on', current_database()) \gexec
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();
