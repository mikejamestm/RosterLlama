FROM postgres:17-alpine
COPY db/persistent/start.sh /usr/local/bin/persistent-start.sh
COPY db/persistent/freeze.sql /usr/local/share/freeze.sql
COPY db/persistent/unfreeze.sql /usr/local/share/unfreeze.sql
ENTRYPOINT ["sh", "/usr/local/bin/persistent-start.sh"]
