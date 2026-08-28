"""Connection helpers for the CORE layer. No LLM, no business logic — just DSNs from env with local-compose defaults."""
import os

import psycopg2
import clickhouse_connect

PG_DSN = os.environ.get("DARKSPOT_PG_DSN", "postgresql://darkspot:darkspot@localhost:5433/darkspot")
CH_HOST = os.environ.get("DARKSPOT_CH_HOST", "localhost")
CH_PORT = int(os.environ.get("DARKSPOT_CH_PORT", "8124"))
CH_USER = os.environ.get("DARKSPOT_CH_USER", "darkspot")
CH_PASSWORD = os.environ.get("DARKSPOT_CH_PASSWORD", "darkspot")


def pg():
    return psycopg2.connect(PG_DSN)


def ch():
    return clickhouse_connect.get_client(host=CH_HOST, port=CH_PORT, username=CH_USER, password=CH_PASSWORD, database="darkspot")
