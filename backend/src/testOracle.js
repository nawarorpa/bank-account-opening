import 'dotenv/config';
import oracledb from 'oracledb';

const connection = await oracledb.getConnection({
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: process.env.ORACLE_CONNECT_STRING,
});

try {
  const result = await connection.execute(
    `SELECT USER AS "username", sys_context('USERENV', 'SERVICE_NAME') AS "service_name" FROM dual`,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  console.log(result.rows[0]);
} finally {
  await connection.close();
}
