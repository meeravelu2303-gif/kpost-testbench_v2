import { readFileSync } from 'node:fs';
import { databaseConfig } from '@config/database.config';
import { SUITE_IDS, type SuiteId } from '@config/ownership.config';
import { isReadOnlyStatement } from '@database/database-client';
import { expect, test } from '@fixtures';

/**
 * Proves the bench cannot write to the live Admin database under any env combination, while the
 * KPost/KMail test DB stays writable. Policy only: no database or network needed.
 */
test.describe('Admin database is never writable @framework', () => {
  test('admin-api is on the write-ban list', () => {
    expect(
      databaseConfig.isWriteBanned('admin-api'),
      'admin-api runs against a live production database',
    ).toBe(true);
  });

  test('the KPost and KMail suites are NOT banned — the ban is targeted, not blanket', () => {
    // A blanket ban would pass every test below while disabling the test-DB writes the bench needs.
    for (const suite of ['kpost-api', 'kmail-api'] as SuiteId[]) {
      expect(
        databaseConfig.isWriteBanned(suite),
        `${suite} runs against KPOST_QA, where writes are permitted`,
      ).toBe(false);
    }
  });

  test('DB_ALLOW_WRITES cannot unlock writes on the Admin database', () => {
    // DB_ALLOW_WRITES=true is the intended KPOST_QA setting; Admin must stay read-only anyway.
    const admin = databaseConfig.forSuite('admin-api');

    expect(admin.allowWrites, 'Admin stays read-only whatever DB_ALLOW_WRITES says').toBe(false);
    expect(admin.writeBanReason, 'the refusal carries its reason').toMatch(/LIVE production/i);
  });

  test('every suite that allows writes is one of the test-database suites', () => {
    // Over the whole suite list, so a suite added later is covered automatically.
    const writable = SUITE_IDS.filter((suite) => databaseConfig.forSuite(suite).allowWrites);
    const bannedButWritable = writable.filter((suite) => databaseConfig.isWriteBanned(suite));

    expect(
      bannedButWritable,
      'a write-banned suite must never resolve to a writable target',
    ).toEqual([]);
  });

  test('the Admin connection is configured separately from the KPost one', () => {
    // Shared variables would let the KPOST_QA credentials silently serve Admin.
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

    expect(admin.kind, 'no connection means no client').toBe('none');
    // The engine reports a disabled client as SKIPPED with a reason, never as passed.
    expect(admin.allowWrites, 'and still not writable').toBe(false);
  });
});

test.describe('read-only statement classification @framework', () => {
  // The runtime half of the ban: what counts as a write.
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
      // MySQL 8 allows a CTE in front of UPDATE/DELETE, so a `WITH` prefix proves nothing.
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

  test('the Admin MongoDB reader has no write path', () => {
    // The only code touching the Admin MongoDB: find/findOne only, never hands out the client.
    const source = readFileSync('src/database/admin-mongo.ts', 'utf8');
    for (const write of [
      /\.insert(One|Many)?\(/,
      /\.update(One|Many)?\(/,
      /\.(delete|remove)(One|Many)?\(/,
      /\.replaceOne\(/,
      /\.findOneAnd(Update|Replace|Delete)\(/,
      /\.bulkWrite\(/,
      /\.(drop|dropDatabase|createIndex|command|aggregate)\(/,
    ]) {
      expect(source, `the reader never calls ${write.source}`).not.toMatch(write);
    }
    expect(source, 'the reader never exports the client or a collection').not.toMatch(
      /export (const|let|function) \w*(client|collection)/i,
    );
  });
});
