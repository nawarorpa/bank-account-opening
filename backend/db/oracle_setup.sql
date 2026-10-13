-- Investor Bank Account Opening - Oracle setup/migration
-- Run this script in SQL Developer with Run Script (F5), connected as INVESTOR_APP
-- to FREEPDB1. It safely upgrades the earlier APPLICATIONS/DOCUMENTS tables.

SET SERVEROUTPUT ON;

DECLARE
  v_count NUMBER;
  PROCEDURE add_column(p_table VARCHAR2, p_column VARCHAR2, p_definition VARCHAR2) IS
    v_column_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_column_count
    FROM user_tab_columns
    WHERE table_name = UPPER(p_table)
      AND column_name = UPPER(p_column);

    IF v_column_count = 0 THEN
      EXECUTE IMMEDIATE
        'ALTER TABLE ' || DBMS_ASSERT.SIMPLE_SQL_NAME(p_table) ||
        ' ADD (' || DBMS_ASSERT.SIMPLE_SQL_NAME(p_column) || ' ' || p_definition || ')';
      DBMS_OUTPUT.PUT_LINE('Added ' || p_table || '.' || p_column);
    ELSE
      DBMS_OUTPUT.PUT_LINE('Already exists: ' || p_table || '.' || p_column);
    END IF;
  END;
BEGIN
  -- APPLICATIONS upgrades for the current prototype schema.
  add_column('APPLICATIONS', 'APPLICATION_NUMBER', 'VARCHAR2(30)');
  add_column('APPLICATIONS', 'SUBMITTED_AT', 'TIMESTAMP WITH TIME ZONE');
  add_column('APPLICATIONS', 'REVIEWED_AT', 'TIMESTAMP WITH TIME ZONE');
  add_column('APPLICATIONS', 'REVIEWED_BY', 'VARCHAR2(100)');
  add_column('APPLICATIONS', 'REVIEW_NOTE', 'VARCHAR2(2000)');

  -- DOCUMENTS upgrade for the current prototype schema.
  add_column('DOCUMENTS', 'SIZE_BYTES', 'NUMBER');
END;
/

-- Backfill identifiers for any legacy application rows.
UPDATE APPLICATIONS
SET APPLICATION_NUMBER = 'LEGACY-' || SUBSTR(APPLICATION_ID, 1, 12)
WHERE APPLICATION_NUMBER IS NULL;

COMMIT;

-- Ensure application numbers can be used safely by the backend.
DECLARE
  v_exists NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_exists
  FROM user_constraints
  WHERE table_name = 'APPLICATIONS'
    AND constraint_name = 'UK_APPLICATION_NUMBER';

  IF v_exists = 0 THEN
    EXECUTE IMMEDIATE
      'ALTER TABLE APPLICATIONS ADD CONSTRAINT UK_APPLICATION_NUMBER UNIQUE (APPLICATION_NUMBER)';
    DBMS_OUTPUT.PUT_LINE('Created UK_APPLICATION_NUMBER');
  ELSE
    DBMS_OUTPUT.PUT_LINE('UK_APPLICATION_NUMBER already exists');
  END IF;
END;
/

ALTER TABLE APPLICATIONS MODIFY APPLICATION_NUMBER VARCHAR2(30) NOT NULL;

-- Create the audit/monitoring table only if it does not exist.
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM user_tables
  WHERE table_name = 'APPLICATION_AUDIT_LOG';

  IF v_count = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE APPLICATION_AUDIT_LOG (
        AUDIT_ID       VARCHAR2(36) PRIMARY KEY,
        APPLICATION_ID VARCHAR2(36) NOT NULL,
        ACTOR_TYPE     VARCHAR2(20) NOT NULL,
        ACTOR_USERNAME VARCHAR2(100),
        ACTION         VARCHAR2(50) NOT NULL,
        FROM_STATUS    VARCHAR2(30),
        TO_STATUS      VARCHAR2(30),
        NOTE           VARCHAR2(2000),
        CREATED_AT     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT FK_AUDIT_APPLICATION
          FOREIGN KEY (APPLICATION_ID)
          REFERENCES APPLICATIONS(APPLICATION_ID)
      )
    ]';
    DBMS_OUTPUT.PUT_LINE('Created APPLICATION_AUDIT_LOG');
  ELSE
    DBMS_OUTPUT.PUT_LINE('APPLICATION_AUDIT_LOG already exists');
  END IF;
END;
/

-- Helpful indexes. Ignore duplicate-index errors only.
BEGIN
  EXECUTE IMMEDIATE
    'CREATE INDEX IX_APPLICATIONS_STATUS_CREATED ON APPLICATIONS (STATUS, CREATED_AT)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE
    'CREATE INDEX IX_DOCUMENTS_APPLICATION ON DOCUMENTS (APPLICATION_ID)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
  EXECUTE IMMEDIATE
    'CREATE INDEX IX_AUDIT_APPLICATION_CREATED ON APPLICATION_AUDIT_LOG (APPLICATION_ID, CREATED_AT)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

COMMIT;

SELECT table_name FROM user_tables ORDER BY table_name;

SELECT column_name, data_type, nullable
FROM user_tab_columns
WHERE table_name IN ('APPLICATIONS', 'DOCUMENTS', 'APPLICATION_AUDIT_LOG')
ORDER BY table_name, column_id;
