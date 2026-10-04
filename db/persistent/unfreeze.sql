SELECT format('ALTER DATABASE %I RESET default_transaction_read_only', current_database()) \gexec
