import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  parseCanonicalRoomSnapshot,
  serializeCanonical,
  type AcceptedRoomCommand,
  type CanonicalRoomSnapshot,
  type CommandAck,
} from './protocol';

type CommandRow = {
  ack_json: string;
};

type SnapshotRow = {
  snapshot_json: string;
};

export class RoomPersistence {
  private readonly db: DatabaseSync;

  constructor(path = process.env.ANMIKA_DB_PATH || resolve('data', 'anmika.sqlite3')) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS room_state_snapshots (
        room_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS room_accepted_commands (
        room_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        actor_seat INTEGER NOT NULL,
        action_json TEXT NOT NULL,
        ack_json TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        PRIMARY KEY (room_id, command_id),
        UNIQUE (room_id, revision)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  loadSnapshot(roomId: string): CanonicalRoomSnapshot | null {
    const row = this.db.prepare(
      'SELECT snapshot_json FROM room_state_snapshots WHERE room_id=?',
    ).get(roomId) as SnapshotRow | undefined;
    return row ? parseCanonicalRoomSnapshot(row.snapshot_json) : null;
  }

  findAck(roomId: string, commandId: string): CommandAck | null {
    const row = this.db.prepare(
      'SELECT ack_json FROM room_accepted_commands WHERE room_id=? AND command_id=?',
    ).get(roomId, commandId) as CommandRow | undefined;
    return row ? JSON.parse(row.ack_json) as CommandAck : null;
  }

  saveSnapshot(snapshot: CanonicalRoomSnapshot): void {
    this.db.prepare(`
      INSERT INTO room_state_snapshots(room_id, schema_version, revision, snapshot_json, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(room_id) DO UPDATE SET
        schema_version=excluded.schema_version,
        revision=excluded.revision,
        snapshot_json=excluded.snapshot_json,
        updated_at=excluded.updated_at
    `).run(
      snapshot.roomId,
      snapshot.schemaVersion,
      snapshot.revision,
      serializeCanonical(snapshot),
      snapshot.updatedAt,
    );
  }

  /** Replace a recycled lobby ID without letting old command IDs leak in. */
  resetRoom(snapshot: CanonicalRoomSnapshot): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM room_accepted_commands WHERE room_id=?').run(snapshot.roomId);
      this.saveSnapshot(snapshot);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 事故復帰用の巻き戻し [2026-07-20 リョー要望]。
   * keepThroughRevision より後の受理コマンドを捨て、巻き戻した snapshot を保存する。
   * コマンド削除と snapshot 更新は同一トランザクションで行う。片方だけ成功すると
   * 次回 restoreAuthority が食い違った revision を replay して復元不能になるため。
   */
  rewindRoom(snapshot: CanonicalRoomSnapshot, keepThroughRevision: number): number {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(
        'DELETE FROM room_accepted_commands WHERE room_id=? AND revision > ?',
      ).run(snapshot.roomId, keepThroughRevision);
      this.saveSnapshot(snapshot);
      this.db.exec('COMMIT');
      return Number((result as any)?.changes ?? 0);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  loadCommands(roomId: string): AcceptedRoomCommand[] {
    const rows = this.db.prepare(
      'SELECT command_id, revision, actor_seat, action_json, ack_json, accepted_at FROM room_accepted_commands WHERE room_id=? ORDER BY revision ASC',
    ).all(roomId) as Array<{
      command_id: string; revision: number; actor_seat: number;
      action_json: string; ack_json: string; accepted_at: string;
    }>;
    return rows.map((row) => ({
      commandId: row.command_id,
      revision: row.revision,
      actorSeat: row.actor_seat,
      fromUserId: '',
      action: JSON.parse(row.action_json),
      matchId: 0,
      roundId: 0,
      acceptedAt: row.accepted_at,
    }));
  }

  saveAcceptedCommand(
    snapshot: CanonicalRoomSnapshot,
    command: AcceptedRoomCommand,
    ack: CommandAck,
  ): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO room_accepted_commands(
          room_id, command_id, revision, actor_seat, action_json, ack_json, accepted_at
        ) VALUES(?,?,?,?,?,?,?)
      `).run(
        snapshot.roomId,
        command.commandId,
        command.revision,
        command.actorSeat,
        serializeCanonical(command.action),
        serializeCanonical(ack),
        command.acceptedAt,
      );
      this.saveSnapshot(snapshot);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
