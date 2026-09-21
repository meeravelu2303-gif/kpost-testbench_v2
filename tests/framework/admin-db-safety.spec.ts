import { databaseConfig } from '@config/database.config';
import { SUITE_IDS, type SuiteId } from '@config/ownership.config';
import { env } from '@config/env';
import { isReadOnlyStatement } from '@database/database-client';
import { expect, test } from '@fixtures';

/**
 * The Admin database is a LIVE PRODUCTION system. This file is the proof that the bench cannot
 * write to it.
 *
 * KPost and KMail run against KPOST_QA, a disposable test database where writes are useful and
 * `DB_ALLOW_WRITES=true` is the intended setting. Admin does not. The whole risk therefore sits in
 * one question — can the flag that unlocks writes on KPOST_QA also unlock them on Admin? — and the
 * answer has to be no under every combination of environment variables, not just the ones in the
 * current `.env`.
 *
 * These run with no database and no network: they assert the *policy*, so they cannot be skipped
 * for want of a connection, and they fail the moment somebody adds Admin to a writable path.
 */
test.describe('Admin database is never writable @framework', () => {
  test('admin-api is on the write-ban list', () => {
    expect(
      databaseConfig.isWriteBanned('admin-api'),
      'admin-api runs against a live production database',
    ).toBe(true);
  });

  test('the KPost and KMail suites are NOT banned — the ban is targeted, not blanket', () => {
    /*
     * Stated explicitly because a ban that accidentally covered everything would make every test
     * below pass while quietly disabling the test-database writes the bench actually needs.
     */
    for (const suite of ['kpost-api', 'kmail-api'] as SuiteId[]) {
      expect(
        databaseConfig.isWriteBanned(suite),
        `${suite} runs against KPOST_QA, where writes are permitted`,
      ).toBe(false);
    }
  });

  test('DB_ALLOW_WRITES cannot unlock writes on the Admin database', () => {
    /*
     * The single most important assertion in this file. `DB_ALLOW_WRITES=true` is the project's
     * current, intended setting for KPOST_QA — so this proves that the flag which is ON right now
     * still leaves Admin read-only.
     */
    const admin = databaseConfig.forSuite('admin-api');

    expect(admin.allowWrites, 'Admin stays read-only whatever DB_ALLOW_WRITES says').toBe(false);
    expect(admin.writeBanReason, 'the refusal carries its reason').toMatch(/LIVE production/i);
  });

  test('every suite that allows writes is one of the test-database suites', () => {
    /*
     * Written over the whole suite list rather than over `admin-api` alone: a suite added later
     * lands here automatically, which is the case the targeted tests above would miss.
     */
    const writable = SUITE_IDS.filter((suite) => databaseConfig.forSuite(suite).allowWrites);
    const bannedButWritable = writable.filter((suite) => databaseConfig.isWriteBanned(suite));

    expect(
      bannedButWritable,
      'a write-banned suite must never resolve to a writable target',
    ).toEqual([]);
  });

  test('the Admin connection is configured separately from the KPost one', () => {
    /*
     * Sharing variables would mean the KPOST_QA credentials silently serving Admin — the bench
     * would report on the wrong database entirely, and its findings would be about test data while
     * claiming to be about production.
     */
    const admin = databaseConfig.forSuite('admin-api');
    const kpost = databaseConfig.forSuite('kpost-api');

    if (admin.connection && kpost.connection) {
      const sameTarget =
        admin.connection.host === kpost.connection.host &&
        admin.connection.port === kpost.connection.port &&
        admin.connection.database === kpost.connection.database;
      expect(sameTarget, 'Admin must not silently inherit the KPost test database').toBe(false);
    } else {
      // The current state: no ADMIN_DB_* supplied, so Admin has no connection at all.
      expect(
        admin.connection,
        'with ADMIN_DB_* unset, Admin resolves to no connection rather than borrowing KPost’s',
      ).toBeUndefined();
    }
  });

  test('with no Admin connection configured, its validations are disabled rather than passing', () => {
    test.skip(databaseConfig.hasAdminConnection, 'an Admin connection has been configured');

    const admin = databaseConfig.forSuite('admin-api');

    expect(admin.kind, 'no connection means no client').toBe(
      env.MOCK_API || env.DB_TYPE === 'mock' ? 'mock' : 'none',
    );
    /*
     * The important half: "we could not check Admin's database" must never be recorded as "Admin's
     * database is correct". The engine turns a disabled client into SKIPPED with the reason
     * attached — see ValidationEngine.databaseValidators.
     */
    expect(admin.allowWrites, 'and still not writable').toBe(false);
  });
});

test.describe('read-only statement classification @framework', () => {
  /*
   * The runtime half of the ban. The policy above decides *whether* a target may write; this
   * decides *what counts as* a write, and a gap here would let a write through on a target whose
   * policy correctly says no.
   */
  test('statements that modify data are never classified as reads', () => {
    const writes = [
      'INSERT INTO users VALUES (1)',
      'insert into users values (1)',
      'UPDATE users SET name = "x"',
      'DELETE FROM users WHERE id = 1',
      'REPLACE INTO users VALUES (1)',
      'DROP TABLE users',
      'TRUNCATE TABLE users',
      'ALTER TABLE users ADD COLUMN x INT',
      'CREATE TABLE t (id INT)',
      'GRANT ALL ON *.* TO x',
      'SET GLOBAL read_only = 0',
      'CALL do_something()',
      'LOAD DATA INFILE "/tmp/x" INTO TABLE users',
      /*
       * MySQL 8 permits a CTE in front of an UPDATE or DELETE, so a `WITH` prefix proves nothing.
       * This is the case the PostgreSQL version of the gate got wrong, and it would have been a
       * write reaching the live Admin database.
       */
      'WITH doomed AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM doomed)',
      'WITH c AS (SELECT 1) UPDATE users SET name = "x"',
    ];

    for (const sql of writes) {
      expect(isReadOnlyStatement(sql), `${sql} must not pass as a read`).toBe(false);
    }
  });

  test('ordinary reads are recognised, so the ban does not block legitimate assertions', () => {
    const reads = [
      'SELECT * FROM users',
      '   SELECT 1',
      'select count(*) from users',
      'SHOW TABLES',
      'DESCRIBE users',
      'DESC users',
      'EXPLAIN SELECT * FROM users',
    ];

    for (const sql of reads) {
      expect(isReadOnlyStatement(sql), `${sql} is a legitimate read`).toBe(true);
    }
  });
});
