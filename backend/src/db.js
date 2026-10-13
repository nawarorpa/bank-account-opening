import oracledb from 'oracledb';
import 'dotenv/config';

// Return Oracle CLOB payloads as normal strings for JSON parsing and admin display.
oracledb.fetchAsString = [oracledb.CLOB];

const user = process.env.ORACLE_USER;
const password = process.env.ORACLE_PASSWORD;
const connectString = process.env.ORACLE_CONNECT_STRING;

if (!user || !password || !connectString) {
  throw new Error(
    'Missing ORACLE_USER, ORACLE_PASSWORD, or ORACLE_CONNECT_STRING in .env'
  );
}

export const pool = await oracledb.createPool({
  user,
  password,
  connectString,
  poolMin: 1,
  poolMax: 10,
  poolIncrement: 1,
});

export async function withConnection(callback) {
  const connection = await pool.getConnection();

  try {
    return await callback(connection);
  } finally {
    await connection.close();
  }
}